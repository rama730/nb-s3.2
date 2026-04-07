import fs from "node:fs";
import path from "node:path";

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function listRouteFiles(baseDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === "route.ts") {
        out.push(full);
      }
    }
  };
  walk(baseDir);
  return out;
}

const NON_V1_ALLOWLIST = new Set<string>([
  "src/app/api/e2e/auth/route.ts",
  "src/app/api/realtime/presence-token/route.ts",
]);

function main() {
  const repoRoot = process.cwd();
  const apiDir = path.join(repoRoot, "src", "app", "api");
  const files = listRouteFiles(apiDir).map((file) => toPosix(path.relative(repoRoot, file)));
  const errors: string[] = [];

  for (const rel of files) {
    const isV1 = rel.startsWith("src/app/api/v1/");
    if (isV1) continue;
    if (!NON_V1_ALLOWLIST.has(rel)) {
      errors.push(`Non-versioned API route is not allowlisted: ${rel}`);
    }
  }

  if (errors.length > 0) {
    console.error("[api-versioning-contract] violations detected:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `[api-versioning-contract] ok (${files.length} routes, ${NON_V1_ALLOWLIST.size} allowlisted non-v1 routes).`,
  );
}

main();

