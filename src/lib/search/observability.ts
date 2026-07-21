import { logger } from "@/lib/logger";

type SearchDomain = "hub" | "people" | "project-tasks";
type SearchOutcome = "success" | "empty" | "rate-limited" | "error";

export type GlobalSearchMetric = {
  domain: SearchDomain;
  scope?: string;
  outcome: SearchOutcome;
  durationMs: number;
  resultCount: number;
  queryLength: number;
  tokenCount: number;
};

const PRODUCTION_SAMPLE_RATE = 0.2;

function queryLengthBucket(length: number) {
  if (length <= 2) return "2";
  if (length <= 8) return "3-8";
  if (length <= 24) return "9-24";
  if (length <= 50) return "25-50";
  return "51-100";
}

/**
 * Records only bounded operational dimensions. Raw search text, identifiers,
 * and result titles are deliberately excluded from this contract.
 */
export function recordGlobalSearchMetric(metric: GlobalSearchMetric) {
  if (process.env.NODE_ENV === "production" && Math.random() > PRODUCTION_SAMPLE_RATE) return;

  logger.metric("global_search.preview", {
    module: "global-search",
    domain: metric.domain,
    scope: metric.scope,
    outcome: metric.outcome,
    durationMs: Math.max(0, Math.round(metric.durationMs)),
    resultCount: Math.max(0, Math.round(metric.resultCount)),
    queryLengthBucket: queryLengthBucket(metric.queryLength),
    tokenCount: Math.max(0, Math.min(8, Math.round(metric.tokenCount))),
  });
}
