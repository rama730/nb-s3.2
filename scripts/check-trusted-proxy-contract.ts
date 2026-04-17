import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.cwd();
  const requestIpSource = await readFile(path.join(root, "src/lib/security/request-ip.ts"), "utf8");
  const sharedRouteSource = await readFile(path.join(root, "src/app/api/v1/_shared.ts"), "utf8");

  const rawHeaderMatches = execFileSync(
    "rg",
    ["-n", "x-forwarded-for|x-real-ip", "src", "-g", "!**/*.map"],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);

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
