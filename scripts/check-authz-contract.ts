import { readFile } from "node:fs/promises";
import path from "node:path";

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

async function main() {
  const [
    projectActions,
    messagingActions,
    changePasswordRoute,
    gitSyncWorker,
    accountCleanupWorker,
    profileData,
    connectionsActions,
    profileService,
  ] = await Promise.all([
    readWorkspaceFile("src/app/actions/project/_all.ts"),
    readWorkspaceFile("src/app/actions/messaging/_all.ts"),
    readWorkspaceFile("src/app/api/v1/auth/change-password/route.ts"),
    readWorkspaceFile("src/inngest/functions/git-sync.ts"),
    readWorkspaceFile("src/inngest/functions/account-cleanup.ts"),
    readWorkspaceFile("src/lib/data/profile.ts"),
    readWorkspaceFile("src/app/actions/connections.ts"),
    readWorkspaceFile("src/lib/services/profile-service.ts"),
  ]);

  const checks: Array<[string, boolean]> = [
    [
      "task mutations are scoped to the supplied project",
      projectActions.includes(".where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))"),
    ],
    [
      "message attachments use authenticated access URLs instead of raw signed storage URLs",
      messagingActions.includes("buildMessageAttachmentAccessUrl(attachment.id)"),
    ],
    [
      "passwordless password changes require MFA step-up",
      changePasswordRoute.includes("Set up MFA and verify this device before setting a password on this account"),
    ],
    [
      "git workers verify signed job requests",
      gitSyncWorker.includes('verifySignedJobRequestToken(jobSignature') && gitSyncWorker.includes('kind: "git/pull"'),
    ],
    [
      "account cleanup worker verifies signed job requests",
      accountCleanupWorker.includes('verifySignedJobRequestToken(jobSignature'),
    ],
    [
      "profile reads use the shared viewer-scoped serializer",
      profileData.includes("buildViewerScopedProfileView(") &&
        profileService.includes("export async function getViewerScopedProfile("),
    ],
    [
      "privacy-sensitive profile surfaces emit read audit events",
      profileData.includes("recordPrivacyReadEvent(") &&
        connectionsActions.includes("recordPrivacyReadEvents(") &&
        messagingActions.includes("recordPrivacyReadEvent("),
    ],
  ];

  const failed = checks.filter(([, passed]) => !passed);
  if (failed.length > 0) {
    throw new Error(`Authorization contract failed: ${failed.map(([label]) => label).join(", ")}`);
  }

  console.log("[authz-contract] ok");
}

main().catch((error) => {
  console.error("[authz-contract] failed:", error);
  process.exit(1);
});

export {};
