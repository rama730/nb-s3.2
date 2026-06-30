import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function globFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const res = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return globFiles(res);
      } else {
        return entry.name.endsWith(".map") ? [] : [res];
      }
    })
  );
  return files.flat();
}

async function main() {
  const root = process.cwd();
  const requestIpSource = await readFile(path.join(root, "src/lib/security/request-ip.ts"), "utf8");
  const sharedRouteSource = await readFile(path.join(root, "src/app/api/v1/_shared.ts"), "utf8");

  const files = await globFiles(path.join(root, "src"));
  const rawHeaderMatches: string[] = [];
  for (const file of files) {
    const relativePath = path.relative(root, file);
    const content = await readFile(file, "utf8");
    if (content.toLowerCase().includes("x-forwarded-for") || content.toLowerCase().includes("x-real-ip")) {
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes("x-forwarded-for") || line.toLowerCase().includes("x-real-ip")) {
          rawHeaderMatches.push(`${relativePath}:${index + 1}:${line}`);
        }
      });
    }
  }

  const disallowedUsages = rawHeaderMatches.filter((line) => !line.startsWith("src/lib/security/request-ip.ts:"));

  const checks: Array<[string, boolean]> = [
    ["trusted proxy helper requires a platform marker in production", requestIpSource.includes("hasTrustedProxyMarker(headers)")],
    ["API routes resolve request IP through the trusted helper", sharedRouteSource.includes('getTrustedRequestIp(request) ?? "unknown"')],
    ["no raw forwarded headers are read outside the trusted proxy helper", disallowedUsages.length === 0],
  ];

  const failed = checks.filter(([, passed]) => !passed);
  if (failed.length > 0) {
    throw new Error(
      `Trusted proxy contract failed: ${failed.map(([label]) => label).join(", ")}${disallowedUsages.length > 0 ? `; offending usages: ${disallowedUsages.join(" | ")}` : ""}`,
    );
  }

  console.log("[trusted-proxy-contract] ok");
}

main().catch((error) => {
  console.error("[trusted-proxy-contract] failed:", error);
  process.exit(1);
});

export {};
