import fs from "node:fs";
import path from "node:path";
import {
  PAGE_PERFORMANCE_CONTRACTS,
  resolveRouteContract,
} from "../src/lib/performance/page-contract";

type InputSample = {
  route: string;
  nav?: {
    durationMs?: number;
    ttfbMs?: number;
    loadEventMs?: number;
    domContentLoadedMs?: number;
  };
  finalUrl?: string;
  status?: number;
};

type InputFile = {
  measuredAt?: string;
  baseUrl?: string;
  results?: InputSample[];
};

function toNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function main() {
  const repoRoot = process.cwd();
  const inputPath = process.env.ROUTE_BASELINE_INPUT_PATH || "/tmp/page-load-metrics.json";
  const outDir = path.join(repoRoot, "docs", "performance");
  const outPath = path.join(outDir, "route-baseline.json");

  let input: InputFile | null = null;
  if (fs.existsSync(inputPath)) {
    const raw = fs.readFileSync(inputPath, "utf8");
    input = JSON.parse(raw) as InputFile;
  }

  const sampleByRoute = new Map<string, InputSample>();
  for (const sample of input?.results ?? []) {
    if (!sample.route) continue;
    sampleByRoute.set(sample.route, sample);
    const resolved = resolveRouteContract(sample.route);
    if (resolved && !sampleByRoute.has(resolved.routeId)) {
      sampleByRoute.set(resolved.routeId, sample);
    }
  }

  const routes = Object.keys(PAGE_PERFORMANCE_CONTRACTS).map((routeId) => {
    const sample = sampleByRoute.get(routeId);
    return {
      routeId,
      pageFile: PAGE_PERFORMANCE_CONTRACTS[routeId]?.pageFile ?? null,
      status: sample?.status ?? null,
      finalUrl: sample?.finalUrl ?? null,
      browserLoadMs: toNumber(sample?.nav?.loadEventMs),
      browserNavDurationMs: toNumber(sample?.nav?.durationMs),
      serverTtfbMs: toNumber(sample?.nav?.ttfbMs),
      domContentLoadedMs: toNumber(sample?.nav?.domContentLoadedMs),
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: fs.existsSync(inputPath) ? inputPath : null,
    sourceMeasuredAt: input?.measuredAt ?? null,
    routeCount: routes.length,
    routes,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[route-baseline] wrote ${outPath} (${routes.length} routes)`);
}

main();
