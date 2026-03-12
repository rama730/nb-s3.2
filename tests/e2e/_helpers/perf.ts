import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export type PerfSample = {
  runId: string;
  metric: string;
  valueMs: number;
  ts: number;
  route?: string;
};

const runId = process.env.E2E_RUN_ID || "local";
const outDir = path.join(process.cwd(), "test-results", "perf");
const outFile = path.join(outDir, `e2e-perf-${runId}.jsonl`);

function persist(sample: PerfSample): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.appendFileSync(outFile, JSON.stringify(sample) + "\n", "utf8");
}

export class PerfTracker {
  private readonly samples: PerfSample[] = [];

  mark(metric: string, valueMs: number, route?: string): void {
    const sample: PerfSample = {
      runId,
      metric,
      valueMs,
      ts: Date.now(),
      route,
    };
    this.samples.push(sample);
    persist(sample);
  }

  async assertUnder(metric: string, valueMs: number, maxMs: number): Promise<void> {
    this.mark(metric, valueMs);
    await expect(
      valueMs,
      `Performance threshold exceeded for ${metric}: ${valueMs.toFixed(1)}ms > ${maxMs}ms`,
    ).toBeLessThanOrEqual(maxMs);
  }

  getSamples(): PerfSample[] {
    return [...this.samples];
  }
}

export async function measure<T>(
  tracker: PerfTracker,
  metric: string,
  fn: () => Promise<T>,
  maxMs?: number,
): Promise<T> {
  const { result, elapsedMs } = await measureWithTiming(fn);
  tracker.mark(metric, elapsedMs);
  if (typeof maxMs === "number") {
    await tracker.assertUnder(metric, elapsedMs, maxMs);
  }
  return result;
}

export async function measureWithTiming<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; elapsedMs: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, elapsedMs: performance.now() - start };
}

export async function markNavigationMetrics(
  tracker: PerfTracker,
  page: Page,
  route?: string,
): Promise<void> {
  const navigation = await page.evaluate(() => {
    const entries = performance.getEntriesByType("navigation");
    if (!entries || entries.length === 0) return null;
    const nav = entries[entries.length - 1] as PerformanceNavigationTiming;
    const serverTtfb = Math.max(0, nav.responseStart - nav.requestStart);
    const browserLoad = Math.max(0, nav.loadEventEnd - nav.startTime);
    const hydration = Math.max(0, nav.domContentLoadedEventEnd - nav.responseEnd);
    return {
      serverTtfb,
      browserLoad,
      hydration,
    };
  });

  if (!navigation) return;

  tracker.mark("route.server.ttfb", navigation.serverTtfb, route);
  tracker.mark("route.browser.load", navigation.browserLoad, route);
  tracker.mark("route.hydration.ms", navigation.hydration, route);
}
