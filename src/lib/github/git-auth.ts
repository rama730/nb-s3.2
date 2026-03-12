import { chmod, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

type GitEnv = NodeJS.ProcessEnv;

function buildBaseGitEnv(): GitEnv {
    return {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
    };
}

export async function withGitCredentialEnv<T>(
    accessToken: string | null | undefined,
    run: (env: GitEnv) => Promise<T>,
): Promise<T> {
    const baseEnv = buildBaseGitEnv();
    if (!accessToken) return run(baseEnv);

    const askpassDir = await mkdtemp(join(tmpdir(), "nb-git-askpass-"));
    const askpassPath = join(askpassDir, "askpass.sh");
    const askpassScript = [
        "#!/bin/sh",
        'case "$1" in',
        '  *Username*|*username*)',
        '    printf "%s\\n" "${GIT_USERNAME:-x-access-token}"',
        "    ;;",
        '  *Password*|*password*)',
        '    printf "%s\\n" "$GIT_PASSWORD"',
        "    ;;",
        "  *)",
        '    printf "\\n"',
        "    ;;",
        "esac",
        "",
    ].join("\n");

    await writeFile(askpassPath, askpassScript);
    await chmod(askpassPath, 0o700);

    try {
        return await run({
            ...baseEnv,
            GIT_ASKPASS: askpassPath,
            GIT_ASKPASS_REQUIRE: "force",
            GIT_USERNAME: "x-access-token",
            GIT_PASSWORD: accessToken,
        });
    } finally {
        await rm(askpassDir, { recursive: true, force: true }).catch(() => undefined);
    }
}
