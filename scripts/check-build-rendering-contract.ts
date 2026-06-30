import fs from "node:fs";
import path from "node:path";

import { PAGE_PERFORMANCE_CONTRACTS } from "../src/lib/performance/page-contract";

type PrerenderManifest = {
  routes?: Record<string, { initialRevalidateSeconds?: number | false }>;
  dynamicRoutes?: Record<string, unknown>;
};

function main() {
  const nextDir = path.join(process.cwd(), ".next");
  const prerenderPath = path.join(nextDir, "prerender-manifest.json");
  const appPathsPath = path.join(nextDir, "server", "app-paths-manifest.json");
  if (!fs.existsSync(prerenderPath) || !fs.existsSync(appPathsPath)) {
    throw new Error("Next build manifests are missing. Run `npm run build` before this check.");
  }

  const prerender = JSON.parse(fs.readFileSync(prerenderPath, "utf8")) as PrerenderManifest;
  const appPaths = JSON.parse(fs.readFileSync(appPathsPath, "utf8")) as Record<string, string>;
  const prerenderedRoutes = new Set(Object.keys(prerender.routes ?? {}));
  const errors: string[] = [];

  for (const contract of Object.values(PAGE_PERFORMANCE_CONTRACTS)) {
    const appManifestKey = contract.pageFile
      .replace(/^src\/app/, "")
      .replace(/\.tsx$/, "");
    if (!appPaths[appManifestKey]) {
      errors.push(`${contract.routeId}: page is missing from the production app-paths manifest (${appManifestKey})`);
      continue;
    }

    const hasDynamicSegments = contract.routeId.includes("[");
    const isPrerendered = !hasDynamicSegments && prerenderedRoutes.has(contract.routeId);
    if (contract.renderingMode === "dynamic" && isPrerendered) {
      errors.push(`${contract.routeId}: contract says dynamic but the production build prerendered it`);
    }
    if (contract.renderingMode === "static" && !hasDynamicSegments && !isPrerendered) {
      errors.push(`${contract.routeId}: contract says static but the production build did not prerender it`);
    }
    if (contract.renderingMode === "revalidate" && !hasDynamicSegments) {
      const entry = prerender.routes?.[contract.routeId];
      if (!entry || typeof entry.initialRevalidateSeconds !== "number") {
        errors.push(`${contract.routeId}: contract says revalidate but the build has no revalidation entry`);
      }
    }
  }

  if (errors.length > 0) {
    console.error("[build-rendering-contract] violations detected:");
    for (const error of errors) console.error(` - ${error}`);
    process.exit(1);
  }

  console.log(
    `[build-rendering-contract] ok (${Object.keys(PAGE_PERFORMANCE_CONTRACTS).length} page contracts verified against production manifests)`,
  );
}

main();
