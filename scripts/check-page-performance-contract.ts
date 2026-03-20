import fs from "node:fs";
import path from "node:path";
import { PAGE_PERFORMANCE_CONTRACTS } from "../src/lib/performance/page-contract";

const EXPECTED_BACKGROUND_CHANNELS = {
  public_cached: 0,
  user_shell: 1,
  active_surface: 2,
} as const;

const EXPECTED_OVERLOAD_MODES = {
  public_cached: "serve_stale_or_shed",
  user_shell: "fail_closed",
  active_surface: "fail_closed",
} as const;

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

function main() {
  const repoRoot = process.cwd();
  const appDir = path.join(repoRoot, "src", "app");
  const pageFiles = listPageFiles(appDir);
  const errors: string[] = [];

  const pageRouteIds = new Set<string>();

  for (const pageFile of pageFiles) {
    const routeId = pageFileToRouteId(repoRoot, pageFile);
    pageRouteIds.add(routeId);
    const rel = toPosix(path.relative(repoRoot, pageFile));
    const contract = PAGE_PERFORMANCE_CONTRACTS[routeId];
    if (!contract) {
      errors.push(`Missing page performance contract for route "${routeId}" (${rel}).`);
      continue;
    }

    if (contract.pageFile !== rel) {
      errors.push(
        `Contract pageFile mismatch for "${routeId}": expected "${rel}", got "${contract.pageFile}".`,
      );
    }
    if (contract.maxInitialPayloadKb <= 0) {
      errors.push(`Contract maxInitialPayloadKb must be > 0 for route "${routeId}".`);
    }
    if (contract.cacheTtlSeconds < 0) {
      errors.push(`Contract cacheTtlSeconds must be >= 0 for route "${routeId}".`);
    }
    if (!contract.bootstrapReadModel) {
      errors.push(`Contract bootstrapReadModel is required for route "${routeId}".`);
    }
    const expectedChannels = EXPECTED_BACKGROUND_CHANNELS[contract.routeClass];
    if (contract.maxBackgroundChannels !== expectedChannels) {
      errors.push(
        `Contract maxBackgroundChannels mismatch for "${routeId}": expected ${expectedChannels}, got ${contract.maxBackgroundChannels}.`,
      );
    }
    const expectedOverloadMode = EXPECTED_OVERLOAD_MODES[contract.routeClass];
    if (contract.overloadMode !== expectedOverloadMode) {
      errors.push(
        `Contract overloadMode mismatch for "${routeId}": expected "${expectedOverloadMode}", got "${contract.overloadMode}".`,
      );
    }
    if (contract.routeClass === "active_surface" && contract.cacheStrategy !== "none") {
      errors.push(`Active surface route "${routeId}" must use cacheStrategy "none".`);
    }
    if (contract.routeClass === "public_cached" && contract.cacheStrategy === "none") {
      errors.push(`Public cached route "${routeId}" must declare a cacheStrategy other than "none".`);
    }
    if (contract.renderingMode === "revalidate" && (!contract.revalidateSeconds || contract.revalidateSeconds <= 0)) {
      errors.push(`Contract revalidateSeconds must be set for revalidate route "${routeId}".`);
    }
  }

  for (const routeId of Object.keys(PAGE_PERFORMANCE_CONTRACTS)) {
    if (!pageRouteIds.has(routeId)) {
      errors.push(`Contract route "${routeId}" has no matching page.tsx file.`);
    }
  }

  if (errors.length > 0) {
    console.error("[page-performance-contract] violations detected:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `[page-performance-contract] ok (${pageFiles.length} pages, ${Object.keys(PAGE_PERFORMANCE_CONTRACTS).length} contracts).`,
  );
}

main();
