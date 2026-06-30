import { createRequire } from "node:module";

export type InngestExecutionRole = "web" | "worker";

export const WORKER_ONLY_FUNCTION_IDS = [
  "project-import",
  "project-import-hydrate",
  "git-push",
  "git-pull",
  "lock-cleanup",
  "onboarding-claims-repair",
  "flush-project-views",
  "flush-project-likes",
  "project-update-cleanup",
  "project-docs-cleanup",
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
  "notifications-retention",
  "notifications-retention-watchdog",
  "notification-fanout",
  "notification-delivery-refresh",
  "data-archival-cron",
  "upload-intent-cleanup",
] as const;

function getWorkerOnlyFunctions() {
  const loadModule = createRequire(import.meta.url);
  const { flushProjectViews } = loadModule("./functions/flush-views");
  const { flushUpdateLikes } = loadModule("./functions/flush-likes");
  const { cleanupProjectUpdate } = loadModule("./functions/cleanup-update");
  const { cleanupProjectDocs } = loadModule("./functions/cleanup-docs");
  const { gitPull, gitPush, lockCleanup, uploadIntentCleanup } = loadModule("./functions/git-sync");
  const { migrateProjectFileLegacyKeys } = loadModule("./functions/project-files-key-migration");
  const { reconcileProjectFiles } = loadModule("./functions/project-files-reconciliation");
  const { onboardingClaimsRepair } = loadModule("./functions/onboarding-claims-repair");
  const { projectImport } = loadModule("./functions/project-import");
  const { projectImportHydrate } = loadModule("./functions/project-import-hydrate");
  const { projectImportStaleReconcile } = loadModule("./functions/project-import-reconcile");
  const { reconcileWorkspaceProfileCounters } = loadModule("./functions/workspace-counter-reconcile");
  const { workspaceCountersRefresh } = loadModule("./functions/workspace-counter-refresh");
  const { accountCleanup } = loadModule("./functions/account-cleanup");
  const { accountHardDelete } = loadModule("./functions/account-hard-delete");
  const { processBulkConnections } = loadModule("./functions/connections-bulk");
  const { computeSocialGraphSuggestions } = loadModule("./functions/social-graph-suggestions");
  const { computeActiveConnections } = loadModule("./functions/active-connections");
  const { notificationsRetention } = loadModule("./functions/notifications-retention");
  const { notificationsRetentionWatchdog } = loadModule("./functions/notifications-retention-watchdog");
  const { notificationFanout, notificationDeliveryRefresh } = loadModule("./functions/notification-fanout");
  const { dataArchivalCron } = loadModule("./functions/data-archival");

  return [
    projectImport,
    projectImportHydrate,
    gitPush,
    gitPull,
    lockCleanup,
    uploadIntentCleanup,
    onboardingClaimsRepair,
    flushProjectViews,
    flushUpdateLikes,
    cleanupProjectUpdate,
    cleanupProjectDocs,
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
    notificationsRetention,
    notificationsRetentionWatchdog,
    notificationFanout,
    notificationDeliveryRefresh,
    dataArchivalCron,
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

  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error('INNGEST_EXECUTION_ROLE must be explicitly set in production.');
  }

  return "worker";
}

export function getRegisteredInngestFunctions(
  role: InngestExecutionRole = getInngestExecutionRole(),
) {
  return role === "worker" ? [...getWorkerOnlyFunctions()] : [];
}
