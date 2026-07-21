import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildContributionMutations,
  contributionEntryChanged,
  contributionToEditorEntry,
  type ContributionEditorEntry,
} from "@/lib/profile/contribution-editor";
import { profileContributionBatchSchema } from "@/lib/profile/contribution-contract";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import { formatProjectTeamRole } from "@/lib/projects/settings-policies";
import { profileUpdateSchema } from "@/lib/validations/profile";

const read = (path: string) => readFileSync(path, "utf8");
const CONTRIBUTION_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_ID = "223e4567-e89b-42d3-a456-426614174000";
const BATCH_ID = "323e4567-e89b-42d3-a456-426614174000";

function contribution(
  overrides: Partial<ProfileCollaborationContribution> = {},
): ProfileCollaborationContribution {
  return {
    id: CONTRIBUTION_ID,
    projectId: "423e4567-e89b-42d3-a456-426614174000",
    version: 3,
    title: "Lead / Frontend Developer",
    projectTitle: "Ponytail",
    projectHref: "/projects/ponytail",
    projectUrl: "https://example.test/projects/ponytail",
    repoUrl: "https://github.com/example/ponytail",
    description: "Built the editor",
    startDate: "2026-02-01T00:00:00.000Z",
    endDate: null,
    currentlyActive: true,
    skills: ["TypeScript", "React"],
    source: "membership",
    verified: true,
    visibility: "private",
    ...overrides,
  };
}

function editorEntry(overrides: Partial<ContributionEditorEntry> = {}): ContributionEditorEntry {
  return {
    draftId: CONTRIBUTION_ID,
    contributionId: CONTRIBUTION_ID,
    externalKey: null,
    version: 3,
    projectId: "423e4567-e89b-42d3-a456-426614174000",
    projectTitle: "Ponytail",
    roleTitle: "Lead / Frontend Developer",
    startedAt: "2026-02",
    endedAt: "",
    projectUrl: "https://example.test/projects/ponytail",
    repositoryUrl: "https://github.com/example/ponytail",
    skills: ["React", "TypeScript"],
    summary: "Built the editor",
    visibility: "private",
    kind: "platform",
    ...overrides,
  };
}

test("legacy profile JSON is no longer a contribution write authority", () => {
  const parsed = profileUpdateSchema.safeParse({
    experience: [{ projectId: CONTRIBUTION_ID, visibility: "public" }],
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal("experience" in parsed.data, false);

  const profileAction = read("src/app/actions/profile.ts");
  const profileData = read("src/lib/data/profile.ts");
  const browserProfile = read("src/lib/profile/browser-profile.ts");
  const accountAction = read("src/app/actions/account.ts");
  assert.doesNotMatch(profileAction, /syncProfileProjectContributionOverrides/);
  assert.doesNotMatch(profileAction, /patch\.experience\b/);
  assert.doesNotMatch(profileData, /PROFILE_DETAIL_COLUMNS[\s\S]*?experience:\s*true/);
  assert.doesNotMatch(browserProfile, /profile\.experience \?\? profile\.experience_data/);
  assert.doesNotMatch(accountAction, /experience:\s*profiles\.experience/);
  assert.match(accountAction, /projectContributions:\s*contributionExport/);
  assert.match(accountAction, /profileContributionSkills/);
});

test("strict contribution commands reject unsafe, stale-shaped, duplicate, and invalid-date input", () => {
  const base = {
    idempotencyKey: BATCH_ID,
    mutations: [{
      kind: "platform",
      contributionId: CONTRIBUTION_ID,
      expectedVersion: 3,
      visibility: "public",
      summary: null,
      repositoryUrl: "javascript:alert(1)",
      skills: ["React"],
      dates: { startedAt: "2026-03", endedAt: "2026-02" },
    }],
  };
  assert.equal(profileContributionBatchSchema.safeParse(base).success, false);

  const validMutation = {
    ...base.mutations[0],
    repositoryUrl: "https://github.com/example/repo",
    dates: { startedAt: "2026-02", endedAt: null },
  };
  assert.equal(profileContributionBatchSchema.safeParse({
    idempotencyKey: BATCH_ID,
    mutations: [validMutation, validMutation],
  }).success, false);
  assert.equal(profileContributionBatchSchema.safeParse({
    idempotencyKey: "not-a-uuid",
    mutations: [validMutation],
  }).success, false);
  assert.equal(profileContributionBatchSchema.safeParse({
    idempotencyKey: BATCH_ID,
    mutations: [validMutation],
    legacyField: true,
  }).success, false);
});

test("platform editor mutations contain presentation fields but cannot rewrite identity or role", () => {
  const original = editorEntry();
  const changed = editorEntry({
    visibility: "public",
    summary: "A safer summary",
    skills: ["React", "TypeScript", "PostgreSQL"],
  });
  const mutations = buildContributionMutations([original], [changed]);
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0], {
    kind: "platform",
    contributionId: CONTRIBUTION_ID,
    expectedVersion: 3,
    visibility: "public",
    summary: "A safer summary",
    repositoryUrl: "https://github.com/example/ponytail",
    skills: ["PostgreSQL", "React", "TypeScript"],
    dates: { startedAt: "2026-02", endedAt: null },
  });
  assert.equal("projectTitle" in mutations[0]!, false);
  assert.equal("roleTitle" in mutations[0]!, false);
});

test("omitting a platform row never deletes or hides membership-owned lifecycle data", () => {
  assert.deepEqual(buildContributionMutations([editorEntry()], []), []);
});

test("external contributions support creation, versioned editing, and versioned deletion", () => {
  const draft = editorEntry({
    draftId: OTHER_ID,
    contributionId: null,
    externalKey: `manual:${OTHER_ID}`,
    version: 0,
    projectId: null,
    projectTitle: "External project",
    roleTitle: "Contributor",
    projectUrl: "https://example.test/external",
    kind: "external",
  });
  const create = buildContributionMutations([], [draft]);
  assert.equal(create[0]?.kind, "external");
  assert.equal(create[0] && "expectedVersion" in create[0], false);

  const saved = { ...draft, contributionId: OTHER_ID, version: 2 };
  const edited = { ...saved, summary: "Updated" };
  const update = buildContributionMutations([saved], [edited]);
  assert.equal(update[0]?.kind, "external");
  assert.equal(update[0] && "expectedVersion" in update[0] ? update[0].expectedVersion : null, 2);
  assert.deepEqual(buildContributionMutations([saved], []), [{
    kind: "external-delete",
    contributionId: OTHER_ID,
    expectedVersion: 2,
  }]);
});

test("normalized contribution mapping is canonical and dirty detection is order-insensitive for skills", () => {
  const mapped = contributionToEditorEntry(contribution());
  assert.equal(mapped.visibility, "private");
  assert.equal(mapped.startedAt, "2026-02");
  assert.equal(mapped.version, 3);
  assert.deepEqual(mapped.skills, ["React", "TypeScript"]);
  assert.equal(contributionEntryChanged({ ...mapped, skills: ["TypeScript", "React"] }, mapped), false);
});

test("dedicated save is transactional, idempotent, versioned, audited, and invalidates once", () => {
  const action = read("src/app/actions/profile-contributions.ts");
  assert.match(action, /profileContributionBatchSchema\.safeParse/);
  assert.match(action, /db\.transaction/);
  assert.match(action, /eq\(profileProjectContributions\.version, mutation\.expectedVersion/);
  assert.match(action, /syncContributionSkillsBatch\(tx/);
  assert.equal(action.match(/markProfileCollaborationSummaryStale\(user\.id, tx\)/g)?.length, 1);
  assert.match(action, /profile_contribution_batch_saved/);
  assert.match(action, /idempotencyKey/);
  assert.match(action, /ContributionSaveError\("CONFLICT"/);
  assert.match(action, /mutationIndex/);
});

test("reads apply privacy first, prefer relational skills, bound history, and dedupe inflight work", () => {
  const profileData = read("src/lib/data/profile.ts");
  const collaboration = read("src/lib/profile/collaboration.ts");
  const route = read("src/app/api/v1/profiles/[id]/contributions/route.ts");
  assert.ok(profileData.indexOf("const canViewProfile") < profileData.lastIndexOf("getProfileCollaborationSummary"));
  assert.match(collaboration, /queryProfileContributionRows/);
  assert.match(collaboration, /canonical_skills/);
  assert.match(collaboration, /stageLimit/);
  assert.match(collaboration, /runInFlightDeduped/);
  assert.match(collaboration, /const SUMMARY_VERSION = 5/);
  assert.match(collaboration, /newer_invalidation/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /Vary: "Cookie"/);
  assert.match(route, /limit/);
  assert.match(route, /offset/);
});

test("the contribution editor loads real pages and preserves the loaded baseline for discard", () => {
  const browserProfile = read("src/lib/profile/browser-profile.ts");
  const modal = read("src/components/profile/edit/EditProfileModal.tsx");
  const editor = read("src/components/profile/edit/EditProfileTabs.tsx");
  assert.match(browserProfile, /loadProfileContributionsPage/);
  assert.match(browserProfile, /options\.offset/);
  assert.match(modal, /offset: baseEntries\.length/);
  assert.match(modal, /experience: \[\.\.\.baseEntries, \.\.\.additions\]/);
  assert.match(editor, /Load more contributions/);
});

test("parent visibility is the UI and read authority while owners retain a private preview", () => {
  const collaboration = read("src/lib/profile/collaboration.ts");
  const editor = read("src/components/profile/edit/EditProfileTabs.tsx");
  const card = read("src/components/profile/v2/sections/ProjectContributionsCard.tsx");
  const retiredStageRoute = read("src/app/api/v1/profiles/[id]/collaboration-stages/[stageId]/route.ts");
  assert.doesNotMatch(collaboration, /updateProfileProjectContributionStage/);
  assert.doesNotMatch(collaboration, /stage\.visibility/);
  assert.doesNotMatch(collaboration, /legacy_skills/);
  assert.match(editor, /Show publicly on profile/);
  assert.match(editor, /aria-expanded=\{isExpanded\}/);
  assert.match(editor, /Private/);
  assert.match(editor, /Needs attention/);
  assert.match(editor, /Saving…/);
  assert.match(editor, /role="alert"/);
  assert.match(card, /Private/);
  assert.doesNotMatch(card, /collaboration-stages/);
  assert.match(retiredStageRoute, /,\s*410,/);
});

test("profile contributions reuse team role terminology and display only the joined month", () => {
  assert.equal(formatProjectTeamRole({ membershipRole: "owner", leadFocus: "Frontend Developer" }), "Lead / Frontend Developer");
  assert.equal(formatProjectTeamRole({ membershipRole: "owner", projectRoleTitle: "Lead", leadFocus: "Tester" }), "Lead / Tester");
  assert.equal(formatProjectTeamRole({ membershipRole: "member", projectRoleTitle: "QA Engineer" }), "QA Engineer · Member");

  const card = read("src/components/profile/v2/sections/ProjectContributionsCard.tsx");
  assert.doesNotMatch(card, /statusLabel: contribution\.currentlyActive \? 'Current'/);
  assert.doesNotMatch(card, /Present/);
  assert.doesNotMatch(card, /formatRange/);
  assert.match(card, /Joined/);
});

test("migration enforces normalized authority, parent-derived RLS, relational skills, and idempotency", () => {
  const migration = read("drizzle/0127_profile_contribution_authority.sql");
  assert.match(migration, /profile_project_contributions_authority_shape_check/);
  assert.match(migration, /profile_project_contributions_profile_external_active_unique/);
  assert.match(migration, /profile_project_contributions_version_check/);
  assert.match(migration, /INSERT INTO "profile_contribution_skills"/);
  assert.match(migration, /contribution\.visibility = 'public'/);
  assert.match(migration, /profile_audit_events_contribution_batch_key_unique/);
  assert.match(migration, /row_number\(\) OVER/);
  assert.match(migration, /app_private\.get_auth_uid\(\)/);
  assert.doesNotMatch(migration, /public\.get_auth_uid\(\)/);
});
