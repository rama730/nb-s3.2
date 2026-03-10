import fs from 'node:fs';
import path from 'node:path';

type PerfSample = {
  metric: string;
  valueMs: number;
};

const ENABLED = process.env.E2E_PERF_GATE !== '0';
const PERF_DIR = path.join(process.cwd(), 'test-results', 'perf');
const PERF_RUN_ID_FILE = path.join(process.cwd(), '.e2e-last-run-id');

const THRESHOLDS: Record<string, number> = {
  'route.interactive.core': 2000,
  'messages.ready.firstConversation': 1500,
  'files.open': 1200,
  'files.save': 800,
  'ui.search.interaction': 100,
  'project.detail.shell.interactive': 1200,
  'project.detail.tab.switch': 350,
  'project.detail.application.submit': 700,
  'project.detail.application.decision': 900,
  'project.detail.files.tab.open': 1000,
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] || 0;
}

function resolveRunId() {
  const explicit = process.env.E2E_RUN_ID?.trim();
  if (explicit) return explicit;
  if (!fs.existsSync(PERF_RUN_ID_FILE)) return null;
  const fromFile = fs.readFileSync(PERF_RUN_ID_FILE, 'utf8').trim();
  return fromFile || null;
}

function readSamples(): PerfSample[] {
  if (!fs.existsSync(PERF_DIR)) return [];
  const runId = resolveRunId();
  if (!runId) {
    throw new Error(
      `[e2e-perf] Missing E2E_RUN_ID and no persisted run id at ${PERF_RUN_ID_FILE}. Run prod E2E first.`,
    );
  }
  const files = fs.readdirSync(PERF_DIR).filter((name) => name.endsWith('.jsonl'));
  const selected = files.filter((name) => name.includes(runId));
  if (selected.length === 0) {
    const available = files.length > 0 ? files.join(', ') : '(none)';
    throw new Error(
      `[e2e-perf] No perf files found matching E2E_RUN_ID='${runId}' in ${PERF_DIR}. Available files: ${available}`,
    );
  }
  const target = selected;

  const samples: PerfSample[] = [];
  for (const file of target) {
    const full = path.join(PERF_DIR, file);
    const content = fs.readFileSync(full, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as PerfSample;
        if (typeof parsed.metric === 'string' && typeof parsed.valueMs === 'number') {
          samples.push(parsed);
        }
      } catch {
        // ignore malformed lines
      }
    }
  }
  return samples;
}

function main() {
  if (!ENABLED) {
    console.log('E2E perf gate disabled (set E2E_PERF_GATE=0 only for local ad-hoc runs).');
    return;
  }

  const samples = readSamples();
  if (samples.length === 0) {
    throw new Error(
      'No E2E perf samples found. Run critical E2E with perf instrumentation before evaluating the perf gate.',
    );
  }

  const grouped = new Map<string, number[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.metric) || [];
    list.push(sample.valueMs);
    grouped.set(sample.metric, list);
  }

  const failures: Array<{ metric: string; p95: number; max: number }> = [];

  for (const [metric, max] of Object.entries(THRESHOLDS)) {
    const values = grouped.get(metric) || [];
    if (values.length === 0) continue;
    const p95 = percentile(values, 95);
    if (p95 > max) {
      failures.push({ metric, p95, max });
    }
    console.log(`[e2e-perf] ${metric} p95=${p95.toFixed(1)}ms (threshold ${max}ms)`);
  }

  if (failures.length > 0) {
    const summary = failures
      .map((f) => `${f.metric}: p95 ${f.p95.toFixed(1)}ms > ${f.max}ms`)
      .join('\n');
    throw new Error(`E2E performance thresholds exceeded:\n${summary}`);
  }
}

main();
