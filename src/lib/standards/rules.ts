import type { RouteClass } from "@/lib/routing/route-class";
import type {
  ImpactReviewCanonicalDomain,
  ImpactReviewRuntimePlane,
} from "@/lib/standards/impact-review";

export type StandardsRuleSeverity = "critical" | "high" | "medium";
export type StandardsRuleOwner = "architecture" | "platform" | "data" | "security" | "qa";
export type StandardsRuleEnforcementStage = "blocking" | "report_only" | "documented";

export type StandardsRuleEvidence = {
  kind: "script" | "doc" | "report";
  ref: string;
};

export type StandardsRule = {
  id: string;
  title: string;
  summary: string;
  severity: StandardsRuleSeverity;
  owner: StandardsRuleOwner;
  stage: StandardsRuleEnforcementStage;
  routeClasses: Array<RouteClass | "all">;
  runtimePlanes: ImpactReviewRuntimePlane[];
  canonicalDomains: ImpactReviewCanonicalDomain[];
  evidence: StandardsRuleEvidence[];
  exceptionPolicy: string;
};

export const STANDARDS_RULES: StandardsRule[] = [
  {
    id: "NB-ARCH-001",
    title: "Route And Page Contracts",
    summary: "Every user-facing route must declare explicit rendering, cache, invalidation, payload, and overload behavior.",
    severity: "critical",
    owner: "architecture",
    stage: "blocking",
    routeClasses: ["public_cached", "user_shell", "active_surface"],
    runtimePlanes: ["request", "public_read"],
    canonicalDomains: [],
    evidence: [
      { kind: "doc", ref: "docs/performance/new-page-fast-default-checklist.md" },
      { kind: "script", ref: "scripts/check-page-performance-contract.ts" },
      { kind: "script", ref: "scripts/check-force-dynamic-allowlist.ts" },
    ],
    exceptionPolicy: "No exceptions outside the documented allowlists in the page contract scripts.",
  },
  {
    id: "NB-ARCH-002",
    title: "Runtime Plane Separation",
    summary: "Request, public-read, realtime, and worker concerns must stay on their intended runtime planes.",
    severity: "critical",
    owner: "architecture",
    stage: "blocking",
    routeClasses: ["all"],
    runtimePlanes: ["request", "public_read", "realtime", "worker"],
    canonicalDomains: [],
    evidence: [
      { kind: "doc", ref: "docs/architecture/system-map.md" },
      { kind: "script", ref: "scripts/check-runtime-boundaries.ts" },
    ],
    exceptionPolicy: "Worker-plane or realtime boundary exceptions require a documented rollback and a time-bounded follow-up removal task.",
  },
  {
    id: "NB-CON-001",
    title: "Canonical Logic Reuse",
    summary: "Shared behaviors such as identity/avatar fallback, status labels, relationship actions, and import filters must come from one canonical implementation.",
    severity: "critical",
    owner: "platform",
    stage: "blocking",
    routeClasses: ["all"],
    runtimePlanes: ["request", "public_read", "realtime"],
    canonicalDomains: ["identity_avatar", "status_lifecycle", "relationship_actions", "import_boundaries"],
    evidence: [
      { kind: "doc", ref: "docs/architecture/engineering-standards-charter.md" },
      { kind: "script", ref: "scripts/check-canonical-logic-contract.ts" },
    ],
    exceptionPolicy: "Deviations are only allowed through a time-bounded standards exception linked to a removal task.",
  },
  {
    id: "NB-DATA-001",
    title: "Normalized Surface Boundaries",
    summary: "Component surfaces must consume normalized view models instead of mixing raw snake_case and camelCase records inline.",
    severity: "high",
    owner: "platform",
    stage: "report_only",
    routeClasses: ["all"],
    runtimePlanes: ["request", "public_read", "realtime"],
    canonicalDomains: ["profile_display", "identity_avatar"],
    evidence: [
      { kind: "script", ref: "scripts/check-data-shape-contract.ts" },
      { kind: "doc", ref: "docs/architecture/engineering-standards-enforcement-matrix.md" },
    ],
    exceptionPolicy: "Legacy surfaces may remain temporarily on the allowlist only while a tracked migration task exists.",
  },
  {
    id: "NB-DB-001",
    title: "SQL Governance",
    summary: "Optimize existing queries first and evolve schema through remigration of the established framework rather than new ad hoc SQL assets.",
    severity: "critical",
    owner: "data",
    stage: "blocking",
    routeClasses: ["all"],
    runtimePlanes: ["database", "request", "worker"],
    canonicalDomains: [],
    evidence: [
      { kind: "doc", ref: "docs/architecture/database-schema-hardening.md" },
      { kind: "script", ref: "scripts/check-sql-governance.ts" },
      { kind: "script", ref: "scripts/check-db-remigration-replay.ts" },
    ],
    exceptionPolicy: "Break-glass SQL changes must be approved in the governance manifest with an expiry date and owner.",
  },
  {
    id: "NB-OPS-001",
    title: "High-Risk Impact Review",
    summary: "High-risk changes require a machine-readable impact review that records runtime, data, observability, concurrency, and rollback decisions.",
    severity: "high",
    owner: "architecture",
    stage: "report_only",
    routeClasses: ["all"],
    runtimePlanes: ["request", "public_read", "realtime", "worker", "database", "ops"],
    canonicalDomains: [],
    evidence: [
      { kind: "doc", ref: "standards/impact-reviews/README.md" },
      { kind: "script", ref: "scripts/check-impact-review.ts" },
    ],
    exceptionPolicy: "High-risk work cannot move to blocking release phases without either an approved impact review or an explicit standards exception.",
  },
  {
    id: "NB-SCALE-001",
    title: "Evidence-Based Scale Claims",
    summary: "1M-readiness claims require release, load, capacity, rollout, and headroom evidence instead of architectural intent alone.",
    severity: "critical",
    owner: "qa",
    stage: "blocking",
    routeClasses: ["all"],
    runtimePlanes: ["ops", "request", "public_read", "realtime", "worker", "database"],
    canonicalDomains: [],
    evidence: [
      { kind: "doc", ref: "docs/stability-rollout-runbook.md" },
      { kind: "script", ref: "scripts/check-1m-readiness.ts" },
      { kind: "report", ref: "reports/stability/headroom/latest.json" },
    ],
    exceptionPolicy: "No route or feature may be described as 1M-ready without the full readiness evidence chain.",
  },
  {
    id: "NB-DEBT-001",
    title: "Lean Complexity Budget",
    summary: "New dependencies, hidden background work, duplicate fetches, and unnecessary code paths are disallowed unless justified by a documented benefit.",
    severity: "high",
    owner: "platform",
    stage: "blocking",
    routeClasses: ["all"],
    runtimePlanes: ["request", "public_read", "realtime", "worker"],
    canonicalDomains: [],
    evidence: [
      { kind: "script", ref: "scripts/check-review-guardrails.sh" },
      { kind: "doc", ref: "docs/architecture/engineering-standards-charter.md" },
    ],
    exceptionPolicy: "Exceptions must name the dependency or added complexity, the reason it is necessary, and the rollback path.",
  },
];

export function getStandardsRule(ruleId: string) {
  return STANDARDS_RULES.find((rule) => rule.id === ruleId) ?? null;
}
