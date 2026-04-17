import { chmod, mkdtemp, open, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

type GitEnv = NodeJS.ProcessEnv;

function buildBaseGitEnv(): GitEnv {
    const env: GitEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
    };

    delete env.GIT_ASKPASS;
    delete env.GIT_ASKPASS_REQUIRE;
    delete env.GIT_USERNAME;
    delete env.NB_GIT_TOKEN_FILE;

    return env;
}

async function wipeAndRemoveFile(filePath: string) {
    try {
        const fileHandle = await open(filePath, "r+");
        try {
            const stats = await fileHandle.stat();
            if (stats.size > 0) {
                await fileHandle.write(Buffer.alloc(stats.size, 0), 0, stats.size, 0);
            }
        } finally {
            await fileHandle.close();
        }
    } catch {
        // Ignore wipe failures and still attempt removal below.
    }

    await rm(filePath, { force: true }).catch(() => undefined);
}

export async function withGitCredentialEnv<T>(
    accessToken: string | null | undefined,
    run: (env: GitEnv) => Promise<T>,
): Promise<T> {
    const baseEnv = buildBaseGitEnv();
    if (!accessToken) return run(baseEnv);

    const askpassDir = await mkdtemp(join(tmpdir(), "nb-git-askpass-"));
    const askpassPath = join(askpassDir, "askpass.sh");
    const tokenPath = join(askpassDir, "token");
    const askpassScript = [
        "#!/bin/sh",
        'case "$1" in',
        '  *Username*|*username*)',
        '    printf "%s\\n" "${GIT_USERNAME:-x-access-token}"',
        "    ;;",
        '  *Password*|*password*)',
        '    cat "$NB_GIT_TOKEN_FILE"',
        "    ;;",
        "  *)",
        '    printf "\\n"',
        "    ;;",
        "esac",
        "",
    ].join("\n");

    await chmod(askpassDir, 0o700);
    await writeFile(tokenPath, accessToken, { mode: 0o600 });
    await writeFile(askpassPath, askpassScript);
    await chmod(askpassPath, 0o700);

    try {
        return await run({
            ...baseEnv,
            GIT_ASKPASS: askpassPath,
            GIT_ASKPASS_REQUIRE: "force",
            GIT_USERNAME: "x-access-token",
            NB_GIT_TOKEN_FILE: tokenPath,
        });
    } finally {
        await wipeAndRemoveFile(tokenPath);
        await wipeAndRemoveFile(askpassPath);
        await rm(askpassDir, { recursive: true, force: true }).catch(() => undefined);
    }
}
