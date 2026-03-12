import fs from "node:fs";
import path from "node:path";
import { resolveRouteContract } from "../src/lib/performance/page-contract";

type BaselineRoute = {
  routeId: string;
  browserLoadMs?: number;
  serverTtfbMs?: number;
};

type BaselineFile = {
  routes?: BaselineRoute[];
};

type PerfSample = {
  metric: string;
  valueMs: number;
  route?: string;
};

const ENABLED = process.env.ROUTE_BASELINE_REGRESSION_CHECK !== "0";
const PERF_DIR = path.join(process.cwd(), "test-results", "perf");
const PERF_RUN_ID_FILE = path.join(process.cwd(), ".e2e-last-run-id");
const BASELINE_FILE = process.env.ROUTE_BASELINE_FILE
  ? path.resolve(process.cwd(), process.env.ROUTE_BASELINE_FILE)
  : path.join(process.cwd(), "docs", "performance", "route-baseline.json");
const ROUTE_LOAD_RATIO = readNonNegativeNumber(
  "ROUTE_BASELINE_LOAD_MAX_REGRESSION_RATIO",
  0.35,
);
const ROUTE_TTFB_RATIO = readNonNegativeNumber(
  "ROUTE_BASELINE_TTFB_MAX_REGRESSION_RATIO",
  0.5,
);
const ROUTE_LOAD_ABS_SLACK_MS = readNonNegativeNumber(
  "ROUTE_BASELINE_LOAD_ABS_SLACK_MS",
  200,
);
const ROUTE_TTFB_ABS_SLACK_MS = readNonNegativeNumber(
  "ROUTE_BASELINE_TTFB_ABS_SLACK_MS",
  120,
);

function readNonNegativeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number, received "${raw}"`);
  }
  return parsed;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] || 0;
}

function resolveRunId(): string | null {
  const explicit = process.env.E2E_RUN_ID?.trim();
  if (explicit) return explicit;
  if (!fs.existsSync(PERF_RUN_ID_FILE)) return null;
  const fromFile = fs.readFileSync(PERF_RUN_ID_FILE, "utf8").trim();
  return fromFile || null;
}

function readPerfSamples(): PerfSample[] {
  if (!fs.existsSync(PERF_DIR)) return [];
  const runId = resolveRunId();
  if (!runId) {
    throw new Error(
      `[route-baseline] Missing E2E_RUN_ID and no persisted run id at ${PERF_RUN_ID_FILE}.`,
    );
  }

  const files = fs.readdirSync(PERF_DIR).filter((name) => name.endsWith(".jsonl"));
  const selected = files.filter((name) => name.includes(runId));
  if (selected.length === 0) {
    throw new Error(
      `[route-baseline] No perf files found matching E2E_RUN_ID='${runId}' in ${PERF_DIR}.`,
    );
  }

  const samples: PerfSample[] = [];
  for (const file of selected) {
    const full = path.join(PERF_DIR, file);
    const content = fs.readFileSync(full, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as PerfSample;
        if (typeof parsed.metric === "string" && typeof parsed.valueMs === "number") {
          samples.push(parsed);
        }
      } catch {
        // Ignore malformed lines.
      }
    }
  }

  return samples;
}

function readBaselineRoutes(): Map<string, BaselineRoute> {
  if (!fs.existsSync(BASELINE_FILE)) {
    throw new Error(
      `[route-baseline] Baseline file not found at ${BASELINE_FILE}. Run npm run freeze:route-baseline.`,
    );
  }

  const raw = fs.readFileSync(BASELINE_FILE, "utf8");
  const parsed = JSON.parse(raw) as BaselineFile;
  const routes = Array.isArray(parsed.routes) ? parsed.routes : [];
  if (routes.length === 0) {
    throw new Error(
      `[route-baseline] Baseline file has no routes at ${BASELINE_FILE}. Run npm run freeze:route-baseline.`,
    );
  }

  const map = new Map<string, BaselineRoute>();
  for (const route of routes) {
    if (!route || typeof route.routeId !== "string") continue;
    map.set(route.routeId, route);
  }
  return map;
}

type RouteMetric = "route.browser.load" | "route.server.ttfb";

function toRouteId(route: string): string {
  const resolved = resolveRouteContract(route);
  return resolved?.routeId ?? route;
}

function maxAllowed(metric: RouteMetric, baselineMs: number): number {
  if (metric === "route.browser.load") {
    return baselineMs * (1 + ROUTE_LOAD_RATIO) + ROUTE_LOAD_ABS_SLACK_MS;
  }
  return baselineMs * (1 + ROUTE_TTFB_RATIO) + ROUTE_TTFB_ABS_SLACK_MS;
}

function main() {
  if (!ENABLED) {
    console.log("[route-baseline] regression gate disabled (ROUTE_BASELINE_REGRESSION_CHECK=0).");
    return;
  }

  const baselineByRoute = readBaselineRoutes();
  const samples = readPerfSamples();
  const routeSamples = samples.filter(
    (sample) =>
      (sample.metric === "route.browser.load" || sample.metric === "route.server.ttfb") &&
      typeof sample.route === "string" &&
      sample.route.length > 0,
  );

  if (routeSamples.length === 0) {
    throw new Error(
      "[route-baseline] No route-level perf samples found. Ensure markNavigationMetrics(...) is called in critical E2E specs.",
    );
  }

  const grouped = new Map<string, number[]>();
  for (const sample of routeSamples) {
    const routeId = toRouteId(sample.route as string);
    const key = `${sample.metric}:${routeId}`;
    const list = grouped.get(key) || [];
    list.push(sample.valueMs);
    grouped.set(key, list);
  }

  const failures: string[] = [];
  let compared = 0;

  for (const [key, values] of grouped.entries()) {
    const [metricRaw, routeId] = key.split(":");
    const metric = metricRaw as RouteMetric;
    const baseline = baselineByRoute.get(routeId);
    if (!baseline) continue;

    const baselineMs =
      metric === "route.browser.load" ? baseline.browserLoadMs : baseline.serverTtfbMs;
    if (typeof baselineMs !== "number" || baselineMs <= 0) continue;

    const p95 = percentile(values, 95);
    const allowed = maxAllowed(metric, baselineMs);
    compared += 1;

    console.log(
      `[route-baseline] ${metric} ${routeId} p95=${p95.toFixed(1)}ms baseline=${baselineMs.toFixed(
        1,
      )}ms allowed<=${allowed.toFixed(1)}ms`,
    );

    if (p95 > allowed) {
      failures.push(
        `${metric} ${routeId}: p95 ${p95.toFixed(1)}ms > allowed ${allowed.toFixed(
          1,
        )}ms (baseline ${baselineMs.toFixed(1)}ms)`,
      );
    }
  }

  if (compared === 0) {
    throw new Error(
      "[route-baseline] No comparable route samples were found against baseline routes.",
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `[route-baseline] Regression threshold exceeded:\n${failures.map((f) => ` - ${f}`).join("\n")}`,
    );
  }

  console.log(`[route-baseline] ok (${compared} route metric checks).`);
}

main();
