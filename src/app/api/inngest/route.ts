
import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { projectImport } from "../../../inngest/functions/project-import";
import { onboardingClaimsRepair } from "../../../inngest/functions/onboarding-claims-repair";
import { gitPush, gitPull, lockCleanup } from "../../../inngest/functions/git-sync";

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        projectImport,
        onboardingClaimsRepair,
        gitPush,
        gitPull,
        lockCleanup,
    ],
});
