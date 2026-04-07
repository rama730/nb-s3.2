import { createRequire } from "node:module";

export type InngestExecutionRole = "web" | "worker";

export const WORKER_ONLY_FUNCTION_IDS = [
  "project-import",
  "git-push",
  "git-pull",
  "lock-cleanup",
  "onboarding-claims-repair",
  "flush-project-views",
  "project-files-reconciliation",
  "project-files-key-migration",
  "project-import-stale-reconcile",
  "reconcile-workspace-profile-counters",
  "workspace-counters-refresh",
  "account-cleanup",
  "account-hard-delete",
  "workspace-connections-bulk",
  "social-graph-suggestions",
  "compute-active-connections",
] as const;

function getWorkerOnlyFunctions() {
  const loadModule = createRequire(import.meta.url);
  const { flushProjectViews } = loadModule("./functions/flush-views");
  const { gitPull, gitPush, lockCleanup } = loadModule("./functions/git-sync");
  const { migrateProjectFileLegacyKeys } = loadModule("./functions/project-files-key-migration");
  const { reconcileProjectFiles } = loadModule("./functions/project-files-reconciliation");
  const { onboardingClaimsRepair } = loadModule("./functions/onboarding-claims-repair");
  const { projectImport } = loadModule("./functions/project-import");
  const { projectImportStaleReconcile } = loadModule("./functions/project-import-reconcile");
  const { reconcileWorkspaceProfileCounters } = loadModule("./functions/workspace-counter-reconcile");
  const { workspaceCountersRefresh } = loadModule("./functions/workspace-counter-refresh");
  const { accountCleanup } = loadModule("./functions/account-cleanup");
  const { accountHardDelete } = loadModule("./functions/account-hard-delete");
  const { processBulkConnections } = loadModule("./functions/connections-bulk");
  const { computeSocialGraphSuggestions } = loadModule("./functions/social-graph-suggestions");
  const { computeActiveConnections } = loadModule("./functions/active-connections");

  return [
    projectImport,
    gitPush,
    gitPull,
    lockCleanup,
    onboardingClaimsRepair,
    flushProjectViews,
    reconcileProjectFiles,
    migrateProjectFileLegacyKeys,
    projectImportStaleReconcile,
    reconcileWorkspaceProfileCounters,
    workspaceCountersRefresh,
    accountCleanup,
    accountHardDelete,
    processBulkConnections,
    computeSocialGraphSuggestions,
    computeActiveConnections,
  ] as const;
}

export function getInngestExecutionRole(): InngestExecutionRole {
  const configured = process.env.INNGEST_EXECUTION_ROLE?.trim().toLowerCase();
  if (configured === "web" || configured === "worker") {
    return configured;
  }

  if (configured) {
    throw new Error('INNGEST_EXECUTION_ROLE must be either "web" or "worker".');
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error('INNGEST_EXECUTION_ROLE must be explicitly set in production.');
  }

  return "worker";
}

export function getRegisteredInngestFunctions(
  role: InngestExecutionRole = getInngestExecutionRole(),
) {
  return role === "worker" ? [...getWorkerOnlyFunctions()] : [];
}
