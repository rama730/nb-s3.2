import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { projectImport } from "@/inngest/functions/project-import";
import { onboardingClaimsRepair } from "@/inngest/functions/onboarding-claims-repair";
import { gitPush, gitPull, lockCleanup } from "@/inngest/functions/git-sync";
import { flushProjectViews } from "@/inngest/functions/flush-views";
import { reconcileProjectFiles } from "@/inngest/functions/project-files-reconciliation";
import { migrateProjectFileLegacyKeys } from "@/inngest/functions/project-files-key-migration";
import { projectImportStaleReconcile } from "@/inngest/functions/project-import-reconcile";

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        projectImport,
        onboardingClaimsRepair,
        gitPush,
        gitPull,
        lockCleanup,
        flushProjectViews,
        reconcileProjectFiles,
        migrateProjectFileLegacyKeys,
        projectImportStaleReconcile,
    ],
});
