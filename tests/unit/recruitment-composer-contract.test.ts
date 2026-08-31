import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("all recruitment entry points use the Invite Collaborator surface", () => {
    const composer = source("src/components/projects/dashboard/InviteCollaboratorModal.tsx");
    const applicationEntry = source("src/components/projects/ApplyRoleModal.tsx");
    const profileInviteEntry = source("src/components/profile/v2/ProfileInviteModal.tsx");
    const guidance = source("src/app/actions/project/guidance.ts");

    assert.match(composer, /mode\?: "invite" \| "apply"/);
    assert.match(composer, /createProjectInvitationAction/);
    assert.match(composer, /applyToRoleAction/);
    assert.match(composer, /Search connections or people/);
    assert.match(composer, /Invite as Guide/);
    assert.match(composer, /query\.length < 2/);
    assert.match(composer, /recruitment-application-draft:v2:\$\{user\?\.id/);
    assert.match(composer, /crypto\.subtle\.digest\("SHA-256"/);
    assert.match(composer, /getProjectGuidancePreflightAction/);
    assert.match(composer, /queryLengthBucket/);
    assert.match(composer, /searchCache/);
    assert.match(composer, /guidancePreflightCache/);
    assert.match(composer, /aria-busy=\{loadingOptions \|\| searching\}/);
    assert.match(composer, /recruitment\.composer\.options/);
    assert.match(composer, /recruitment\.composer\.guidance_preflight/);
    assert.match(composer, /showProjectPicker/);
    assert.match(composer, /setIsChoosingProject\(\(open\) => !open\)/);
    assert.match(composer, /isChoosingProject \? "Cancel" : "Change"/);
    assert.match(composer, /role="listbox"/);
    assert.match(composer, /absolute inset-x-0 top-full/);
    assert.doesNotMatch(composer, /selectedProjectId && !showProjectPicker/);
    assert.doesNotMatch(composer, /<select ref=\{projectSelectRef\}/);
    assert.match(guidance, /export async function getProjectGuidancePreflightAction/);
    assert.match(guidance, /project\.ownerId !== user\.id/);
    assert.match(guidance, /notExists\(db/);
    assert.match(applicationEntry, /InviteCollaboratorModal[\s\S]*mode="apply"/);
    assert.match(profileInviteEntry, /InviteCollaboratorModal/);
});

test("application entry points exclude existing project members", () => {
    const profilePage = source("src/app/(main)/u/[username]/page.tsx");
    const projectAction = source("src/app/actions/project/_all.ts");
    const dashboard = source("src/components/projects/dashboard/ProjectDashboardClient.tsx");

    assert.match(profilePage, /getProfileProjectsWithOpenRolesAction\(data\.profile\.id, viewerAuth\.user\?\.id \?\? null\)/);
    assert.match(projectAction, /excludeMemberUserId/);
    assert.match(projectAction, /NOT EXISTS \([\s\S]*project_members AS excluded_member/);
    assert.match(dashboard, /Project members cannot apply for an additional role/);
});

test("recruitment search preserves the rate limit for incomplete queries and filters members in SQL", () => {
    const guidance = source("src/app/actions/project/guidance.ts");
    const search = guidance.slice(guidance.indexOf("export async function searchProjectInviteCandidatesAction"));

    assert.ok(search.indexOf('if (query && query.length < 2)') < search.indexOf('consumeRateLimit'));
    assert.match(search, /isNotProjectMember = notExists/);
    assert.doesNotMatch(search, /memberRows/);
});

test("invitation expiry uses the database clock in raw SQL", () => {
    const guidance = source("src/app/actions/project/guidance.ts");
    const invitations = source("src/lib/projects/project-invitations.ts");

    assert.match(invitations, /expiresAt\} <= now\(\)/);
    assert.match(guidance, /expiresAt\} <= now\(\)/);
    assert.match(guidance, /expiresAt\} > now\(\)/);
    assert.doesNotMatch(invitations, /expiresAt\} <= \$\{now\}/);
    assert.doesNotMatch(guidance, /expiresAt\}\s*(?:<=|>)\s*\$\{now\}/);
});

test("guidance invitations use the existing Open Roles invitation lifecycle", () => {
    const statusAction = source("src/app/actions/applications/internal.ts");
    const dashboard = source("src/components/projects/dashboard/ProjectDashboardClient.tsx");
    const openRoles = source("src/components/projects/dashboard/OpenRolesCard.tsx");
    const applicationCard = source("src/components/chat/v2/ApplicationSystemCardV2.tsx");

    assert.match(statusAction, /db\.query\.projectInvitations\.findFirst/);
    assert.match(statusAction, /invitationKind: durableInvitation\.kind/);
    assert.match(statusAction, /invitationId: durableInvitation\.id/);
    assert.match(statusAction, /guidanceLabel \|\| 'Guide'/);
    assert.match(dashboard, /resolveProjectInvitationAction/);
    assert.match(dashboard, /applicationStatus\.invitationId/);
    assert.doesNotMatch(dashboard, /rolesWithFilled\.length === 0\) return/);
    assert.match(openRoles, /applicationStatus\.invitationKind === "guidance_appointment"/);
    assert.match(openRoles, />\s*Invited\s*</);
    assert.match(openRoles, /\bAccept\b/);
    assert.match(openRoles, /\bDecline\b/);
    assert.doesNotMatch(applicationCard, />\s*View Profile\s*</);
});
