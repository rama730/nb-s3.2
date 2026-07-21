import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

function requireContract(label: string, passed: boolean) {
  if (!passed) throw new Error(`Profile contribution contract failed: ${label}`);
}

async function main() {
  const [
    schema,
    migration,
    command,
    generalProfileCommand,
    accountCommand,
    profileData,
    browserProfile,
    readModel,
    route,
    editor,
    modal,
    card,
    stageRoute,
    projectUpdates,
    databaseCheck,
    runbook,
  ] = await Promise.all([
    source("src/lib/db/schema/index.ts"),
    source("drizzle/0127_profile_contribution_authority.sql"),
    source("src/app/actions/profile-contributions.ts"),
    source("src/app/actions/profile.ts"),
    source("src/app/actions/account.ts"),
    source("src/lib/data/profile.ts"),
    source("src/lib/profile/browser-profile.ts"),
    source("src/lib/profile/collaboration.ts"),
    source("src/app/api/v1/profiles/[id]/contributions/route.ts"),
    source("src/components/profile/edit/EditProfileTabs.tsx"),
    source("src/components/profile/edit/EditProfileModal.tsx"),
    source("src/components/profile/v2/sections/ProjectContributionsCard.tsx"),
    source("src/app/api/v1/profiles/[id]/collaboration-stages/[stageId]/route.ts"),
    source("src/app/actions/project/updates.ts"),
    source("scripts/check-profile-contribution-database.ts"),
    source("docs/runbooks/profile-contributions.md"),
  ]);

  requireContract("schema has platform-or-external authority constraint", schema.includes("profile_project_contributions_authority_shape_check"));
  requireContract("schema has optimistic version", schema.includes("version: integer('version').default(1).notNull()"));
  requireContract("external identity is unique", schema.includes("profile_project_contributions_profile_external_active_unique"));
  requireContract("migration relationally backfills skills", migration.includes('INSERT INTO "profile_contribution_skills"'));
  requireContract("migration repairs duplicated idempotency history", migration.includes("row_number() OVER"));
  requireContract("migration scopes public reads to parent visibility", migration.includes("contribution.visibility = 'public'"));
  requireContract("migration uses hardened auth helper", migration.includes("app_private.get_auth_uid()") && !migration.includes("public.get_auth_uid()"));

  requireContract("dedicated command validates strict batch", command.includes("profileContributionBatchSchema.safeParse"));
  requireContract("dedicated command is transactional", command.includes("db.transaction"));
  requireContract("dedicated command checks expected versions", command.includes("profileProjectContributions.version, mutation.expectedVersion"));
  requireContract("dedicated command audits idempotency", command.includes("profile_audit_events_contribution_batch_key_unique") || command.includes("profile_contribution_batch_saved"));
  requireContract("general profile command cannot write contribution JSON", !/patch\.experience\b/.test(generalProfileCommand));
  requireContract("account export uses normalized contributions", !accountCommand.includes("experience: profiles.experience") && accountCommand.includes("projectContributions: contributionExport"));
  requireContract("profile detail query does not load retired contribution JSON", !/PROFILE_DETAIL_COLUMNS[\s\S]*?experience:\s*true/.test(profileData));
  requireContract("browser hydration does not depend on retired contribution JSON", !browserProfile.includes("profile.experience ?? profile.experience_data"));
  requireContract("legacy JSON synchronizer is removed", !readModel.includes("syncProfileProjectContributionOverrides"));
  requireContract("legacy stage mutator is removed", !readModel.includes("updateProfileProjectContributionStage"));

  requireContract("read model has a purpose-specific contribution query", readModel.includes("queryProfileContributionRows"));
  requireContract("read model prefers canonical relational skills", readModel.includes("canonical_skills"));
  requireContract("read model has no legacy skill fallback", !readModel.includes("legacy_skills"));
  requireContract("portfolio read uses relational contribution skills", !readModel.includes("pc.skills AS contribution_skills"));
  requireContract("stage presentation has no second visibility authority", !readModel.includes("stage.visibility"));
  requireContract("project update role reads use parent visibility", !projectUpdates.includes('eq(profileProjectContributionStages.visibility, "public")') && projectUpdates.includes('eq(profileProjectContributions.visibility, "public")'));
  requireContract("role history is bounded", readModel.includes("LIMIT ${stageLimit}"));
  requireContract("summary cache version is current", readModel.includes("const SUMMARY_VERSION = 5"));
  requireContract("read requests are deduplicated", readModel.includes("runInFlightDeduped"));
  requireContract("stale cache writes are generation guarded", readModel.includes("newer_invalidation") && readModel.includes("generationStartedAt"));
  requireContract("read metrics exist", readModel.includes("profile.collaboration.contributions"));
  requireContract("API bounds page size", route.includes("Math.min(Math.max(value, 1), 50)"));
  requireContract("API bounds stage history", route.includes("Math.min(Math.max(value, 1), 20)"));
  requireContract("API distinguishes owner private reads", route.includes("includePrivate"));
  requireContract("privacy-sensitive API responses are not reusable", route.includes('"Cache-Control": "private, no-store"'));

  requireContract("editor uses one accordion", editor.includes("aria-expanded={isExpanded}"));
  requireContract("editor exposes incremental pagination", editor.includes("Load more contributions") && modal.includes("handleLoadMoreContributions"));
  requireContract("editor has per-item dirty state", editor.includes("contributionEntryChanged"));
  requireContract("editor has per-item save and error state", editor.includes("Needs attention") && editor.includes("Saving…") && editor.includes('role="alert"'));
  requireContract("platform identity is descriptive text", editor.includes("<dl"));
  requireContract("modal uses dedicated contribution command", modal.includes("saveProfileContributionsAction"));
  requireContract("modal strips legacy contribution payload", modal.includes("withoutLegacyContributionPayload"));
  requireContract("modal attributes server failures to contribution items", modal.includes("setContributionErrors") && modal.includes("result.mutationIndex"));
  requireContract("owner has private preview", card.includes("Only you can see this contribution"));
  requireContract("public empty state is distinct", card.includes("No public project contributions"));
  requireContract("duplicate stage editor is absent", !card.includes("collaboration-stages"));
  requireContract("stale stage clients get terminal response", stageRoute.includes("410") && stageRoute.includes("NOT_SUPPORTED"));
  requireContract("database integration check is disposable-only", databaseCheck.includes("Refusing to run") && databaseCheck.includes("ROLLBACK"));
  requireContract("repair runbook documents authority", runbook.includes("Field ownership matrix"));
  requireContract("repair runbook documents observability", runbook.includes("Observability and alerts"));

  console.log("[profile-contribution-contract] ok");
}

main().catch((error) => {
  console.error("[profile-contribution-contract] failed:", error);
  process.exit(1);
});
