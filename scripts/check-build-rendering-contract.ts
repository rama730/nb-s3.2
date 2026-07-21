import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { PAGE_PERFORMANCE_CONTRACTS } from "../src/lib/performance/page-contract";

type PrerenderManifest = {
  routes?: Record<string, { initialRevalidateSeconds?: number | false }>;
  dynamicRoutes?: Record<string, unknown>;
};

type ClientReferenceManifest = {
  entryJSFiles?: Record<string, string[]>;
};

function parseClientReferenceManifest(manifestPath: string): ClientReferenceManifest | null {
  const source = fs.readFileSync(manifestPath, "utf8");
  const marker = "] =";
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;
  const assignmentIndex = source.indexOf("=", markerIndex);
  if (assignmentIndex === -1) return null;
  try {
    return Function(`return (${source.slice(assignmentIndex + 1).trim().replace(/;\s*$/, "")})`)() as ClientReferenceManifest;
  } catch {
    return null;
  }
}

function routeEntryChunks(manifestPath: string, entryKey: string) {
  const manifest = parseClientReferenceManifest(manifestPath);
  const entryFiles = manifest?.entryJSFiles?.[entryKey];
  if (entryFiles?.length) return new Set(entryFiles);
  const source = fs.readFileSync(manifestPath, "utf8");
  return new Set(source.match(/static\/chunks\/[^"'\\]+?\.js/g) ?? []);
}

function asyncRouteChunks(manifestPath: string) {
  const manifestDir = path.dirname(manifestPath);
  const loadablePath = [
    path.join(manifestDir, "react-loadable-manifest.json"),
    path.join(manifestDir, "page", "react-loadable-manifest.json"),
  ].find((candidate) => fs.existsSync(candidate));
  const chunks = new Set<string>();
  if (!loadablePath) return chunks;
  const loadable = JSON.parse(fs.readFileSync(loadablePath, "utf8")) as Record<string, { files?: string[] }>;
  for (const entry of Object.values(loadable)) {
    for (const file of entry.files ?? []) {
      if (file.endsWith(".js")) chunks.add(file);
    }
  }
  return chunks;
}

function clientPayloadKb(nextDir: string, manifestPath: string, entryKey: string) {
  let rawBytes = 0;
  let gzipBytes = 0;
  const asyncChunks = asyncRouteChunks(manifestPath);
  for (const chunk of routeEntryChunks(manifestPath, entryKey)) {
    if (asyncChunks.has(chunk)) continue;
    const chunkPath = path.join(nextDir, chunk);
    if (!fs.existsSync(chunkPath)) continue;
    const source = fs.readFileSync(chunkPath);
    rawBytes += source.byteLength;
    gzipBytes += gzipSync(source).byteLength;
  }
  return {
    rawKb: rawBytes / 1024,
    gzipKb: gzipBytes / 1024,
  };
}

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
    const builtPage = appPaths[appManifestKey];
    if (!builtPage) {
      errors.push(`${contract.routeId}: page is missing from the production app-paths manifest (${appManifestKey})`);
      continue;
    }

    const clientManifestPath = path.join(
      nextDir,
      "server",
      builtPage.replace(/page\.js$/, "page_client-reference-manifest.js"),
    );
    if (fs.existsSync(clientManifestPath)) {
      const entryKey = `[project]/${contract.pageFile.replace(/\.tsx$/, "")}`;
      const payload = clientPayloadKb(nextDir, clientManifestPath, entryKey);
      if (payload.gzipKb > contract.maxInitialPayloadKb) {
        errors.push(
          `${contract.routeId}: client JS ${Math.ceil(payload.gzipKb)} KB gzip exceeds ${contract.maxInitialPayloadKb} KB budget (${Math.ceil(payload.rawKb)} KB raw)`,
        );
      }
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
