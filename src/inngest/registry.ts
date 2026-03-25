import { flushProjectViews } from "@/inngest/functions/flush-views";
import { gitPull, gitPush, lockCleanup } from "@/inngest/functions/git-sync";
import { migrateProjectFileLegacyKeys } from "@/inngest/functions/project-files-key-migration";
import { reconcileProjectFiles } from "@/inngest/functions/project-files-reconciliation";
import { onboardingClaimsRepair } from "@/inngest/functions/onboarding-claims-repair";
import { projectImport } from "./functions/project-import";
import { projectImportStaleReconcile } from "@/inngest/functions/project-import-reconcile";
import { reconcileWorkspaceProfileCounters } from "@/inngest/functions/workspace-counter-reconcile";
import { workspaceCountersRefresh } from "@/inngest/functions/workspace-counter-refresh";
import { accountCleanup } from "@/inngest/functions/account-cleanup";
import { accountHardDelete } from "@/inngest/functions/account-hard-delete";
import { processBulkConnections } from "@/inngest/functions/connections-bulk";
import { computeSocialGraphSuggestions } from "@/inngest/functions/social-graph-suggestions";

export type InngestExecutionRole = "web" | "worker";

const WORKER_ONLY_FUNCTIONS = [
  projectImport,
  gitPush,
  gitPull,
  lockCleanup,
  onboardingClaimsRepair,
  flushProjectViews,
  reconcileProjectFiles,
  migrateProjectFileLegacyKeys,
  projectImportStaleReconcile,
  processBulkConnections,
  reconcileWorkspaceProfileCounters,
  workspaceCountersRefresh,
  accountCleanup,
  accountHardDelete,
  computeSocialGraphSuggestions,
] as const;

export const WORKER_ONLY_FUNCTION_IDS = [
  "project-import",
  "git-push",
  "git-pull",
  "lock-cleanup",
  "onboarding-claims-repair",
  "flush-project-views",
  "reconcile-project-files",
  "migrate-project-file-legacy-keys",
  "project-import-stale-reconcile",
  "reconcile-workspace-profile-counters",
  "workspace-counters-refresh",
  "account-cleanup",
  "account-hard-delete",
] as const;

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
  return role === "worker" ? [...WORKER_ONLY_FUNCTIONS] : [];
}

