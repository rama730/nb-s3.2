import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

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
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  tracker.mark(metric, elapsed);
  if (typeof maxMs === "number") {
    await tracker.assertUnder(metric, elapsed, maxMs);
  }
  return result;
}
