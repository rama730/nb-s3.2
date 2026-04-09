import { z } from "zod";

export const IMPACT_REVIEW_RUNTIME_PLANES = [
  "request",
  "public_read",
  "realtime",
  "worker",
  "database",
  "ops",
] as const;

export const IMPACT_REVIEW_CANONICAL_DOMAINS = [
  "identity_avatar",
  "status_lifecycle",
  "profile_display",
  "relationship_actions",
  "connection_feed",
  "import_boundaries",
] as const;

export const IMPACT_REVIEW_RISK_LEVELS = [
  "medium",
  "high",
  "critical",
] as const;

const impactReviewEvidenceSchema = z.object({
  commands: z.array(z.string().min(1)).min(1),
  reports: z.array(z.string().min(1)).default([]),
});

const impactReviewObservabilitySchema = z.object({
  metrics: z.array(z.string().min(1)).default([]),
  logs: z.array(z.string().min(1)).default([]),
  alerts: z.array(z.string().min(1)).default([]),
});

const impactReviewRollbackSchema = z.object({
  strategy: z.string().min(1),
  validation: z.array(z.string().min(1)).min(1),
});

export const ImpactReviewRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  riskLevel: z.enum(IMPACT_REVIEW_RISK_LEVELS),
  runtimePlanes: z.array(z.enum(IMPACT_REVIEW_RUNTIME_PLANES)).min(1),
  routeClasses: z.array(z.enum(["public_cached", "user_shell", "active_surface", "none"])).min(1),
  dataSourcesChanged: z.array(z.string().min(1)).min(1),
  canonicalLogicDomains: z.array(z.enum(IMPACT_REVIEW_CANONICAL_DOMAINS)).default([]),
  concurrencyRisk: z.string().min(1),
  observability: impactReviewObservabilitySchema,
  rollback: impactReviewRollbackSchema,
  evidence: impactReviewEvidenceSchema,
  paths: z.array(z.string().min(1)).min(1),
});

export type ImpactReviewRuntimePlane = (typeof IMPACT_REVIEW_RUNTIME_PLANES)[number];
export type ImpactReviewCanonicalDomain = (typeof IMPACT_REVIEW_CANONICAL_DOMAINS)[number];
export type ImpactReviewRiskLevel = (typeof IMPACT_REVIEW_RISK_LEVELS)[number];
export type ImpactReviewRecord = z.infer<typeof ImpactReviewRecordSchema>;

export function parseImpactReviewRecord(value: unknown): ImpactReviewRecord {
  return ImpactReviewRecordSchema.parse(value);
}
