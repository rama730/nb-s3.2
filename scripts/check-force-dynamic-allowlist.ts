import fs from "node:fs";
import path from "node:path";
import {
  FORCE_DYNAMIC_ALLOWLIST,
  PAGE_PERFORMANCE_CONTRACTS,
} from "../src/lib/performance/page-contract";

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function listPageFiles(baseDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === "page.tsx") {
        out.push(full);
      }
    }
  };
  walk(baseDir);
  return out;
}

function pageFileToRouteId(repoRoot: string, absolutePageFile: string): string {
  const rel = toPosix(path.relative(repoRoot, absolutePageFile));
  const underApp = rel.replace(/^src\/app\//, "");
  const noGroups = underApp
    .split("/")
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .join("/");
  const routePart = noGroups.replace(/(^|\/)page\.tsx$/, "");
  return routePart === "" ? "/" : `/${routePart}`;
}

function hasForceDynamicExport(content: string): boolean {
  return (
    /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(content) ||
    /export\s*\{\s*dynamic\s*\}\s*from/.test(content)
  );
}

function main() {
  const repoRoot = process.cwd();
  const appDir = path.join(repoRoot, "src", "app");
  const pageFiles = listPageFiles(appDir);
  const errors: string[] = [];

  for (const pageFile of pageFiles) {
    const rel = toPosix(path.relative(repoRoot, pageFile));
    const routeId = pageFileToRouteId(repoRoot, pageFile);
    const content = fs.readFileSync(pageFile, "utf8");
    const hasForceDynamic = hasForceDynamicExport(content);
    const contract = PAGE_PERFORMANCE_CONTRACTS[routeId];

    if (hasForceDynamic && !FORCE_DYNAMIC_ALLOWLIST.has(routeId)) {
      errors.push(`"${routeId}" uses force-dynamic but is not in allowlist (${rel}).`);
    }

  }

  if (errors.length > 0) {
    console.error("[force-dynamic-allowlist] violations detected:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log(`[force-dynamic-allowlist] ok (${FORCE_DYNAMIC_ALLOWLIST.size} allowlisted routes).`);
}

main();
