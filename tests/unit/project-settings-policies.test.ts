import assert from "node:assert/strict";
import test from "node:test";
import {
    buildProjectAccessImpact,
    buildProjectAccessPolicy,
    buildProjectMemberMutationPolicy,
    buildProjectMemberRemovalPreflight,
    buildProjectPersonReference,
    buildProjectRolePolicy,
    buildProjectSettingsPreflight,
    getProjectMemberRoleLabel,
    isEligibleProjectMember,
    isAssignableProjectMember,
    getVisibleProjectSettingsSections,
    normalizeProjectVisibility,
} from "../../src/lib/projects/settings-policies";
import {
    OTHER_PROJECT_TYPE_ID,
    POPULAR_PROJECT_TAGS,
    POPULAR_PROJECT_TECH,
    PROJECT_TYPE_OPTIONS,
    isKnownProjectType,
} from "../../src/lib/projects/project-create-options";
import { buildProjectDetailMetadataInput } from "../../src/lib/projects/project-detail-metadata";
import {
    isProjectPubliclyReadableVisibility,
    isProjectVisibility,
} from "../../src/lib/projects/project-visibility";

test("project settings hides future-only sections until they are enforceable", () => {
    const ids = getVisibleProjectSettingsSections().map((section) => section.id);
    assert.ok(ids.includes("general"));
    assert.ok(ids.includes("danger"));
    assert.ok(!ids.includes("readme"));
    assert.ok(!ids.includes("updates"));
    assert.ok(!ids.includes("automation"));
});

test("project access policy normalizes unknown visibility fail-closed", () => {
    assert.equal(normalizeProjectVisibility("private"), "private");
    assert.equal(normalizeProjectVisibility("public"), "public");
    assert.equal(normalizeProjectVisibility("unlisted"), "public");
    assert.equal(normalizeProjectVisibility("team-only"), "private");
    assert.equal(normalizeProjectVisibility(null), "private");
    assert.equal(normalizeProjectVisibility(undefined), "private");

    const policy = buildProjectAccessPolicy({ visibility: "private" });
    assert.equal(policy.visibility, "private");
    assert.ok(policy.affectedAreas.some((area) => area.includes("Only the owner and approved project members")));
    assert.ok(policy.viewerRows.some((row) => row.viewer === "Anyone with the link"));
});

test("project visibility helper keeps private closed and treats legacy unlisted as public", () => {
    assert.equal(isProjectPubliclyReadableVisibility("public"), true);
    assert.equal(isProjectPubliclyReadableVisibility("private"), false);
    assert.equal(isProjectPubliclyReadableVisibility("unlisted"), true);
    assert.equal(isProjectPubliclyReadableVisibility("team-only"), false);
    assert.equal(isProjectPubliclyReadableVisibility(null), false);
    assert.equal(isProjectVisibility("public"), true);
    assert.equal(isProjectVisibility("private"), true);
    assert.equal(isProjectVisibility("unlisted"), false);
});

test("project access impact explains counts and transition checklist", () => {
    const privateImpact = buildProjectAccessImpact({
        visibility: "private",
        membersCount: 2,
        followersCount: 3,
        openRolesCount: 1,
        pendingApplicationsCount: 4,
        activeTasksCount: 5,
    });

    assert.equal(privateImpact.visibility, "private");
    assert.ok(privateImpact.summary.some((line) => line.includes("3 followers")));
    assert.ok(privateImpact.metrics.some((metric) => metric.label === "Pending applications" && metric.value === 4));
    assert.ok(privateImpact.transitionChecklist.some((item) => item.includes("safe unavailable metadata")));

    const publicImpact = buildProjectAccessImpact({ visibility: "public", openRolesCount: 2 });
    assert.ok(publicImpact.transitionChecklist.some((item) => item.includes("Restore Hub discovery")));
});

test("project role policy excludes the current owner from transfer candidates", () => {
    const policy = buildProjectRolePolicy({
        isOwner: true,
        ownerId: "owner-1",
        members: [
            { id: "owner-1", fullName: "Owner", membershipRole: "owner" },
            { id: "member-1", fullName: "Member", membershipRole: "member" },
            { id: "admin-1", fullName: "Admin", membershipRole: "admin" },
        ],
    });

    assert.deepEqual(policy.transferCandidates.map((member) => member.id).sort(), ["admin-1", "member-1"]);
    assert.equal(policy.roleCounts.owner, 1);
    assert.equal(policy.roleCounts.member, 1);
    assert.equal(policy.roleCounts.admin, 1);
    assert.equal(policy.roleLabels.admin, "Co-leader");
    assert.equal(policy.coLeaders[0]?.id, "admin-1");
});

test("project member mutation policy protects the true owner and permits lower-role changes", () => {
    const ownerTarget = buildProjectMemberMutationPolicy({
        actorIsOwner: true,
        ownerId: "owner-1",
        targetUserId: "owner-1",
        targetRole: "owner",
    });
    assert.equal(ownerTarget.canRemove, false);
    assert.equal(ownerTarget.canChangeRole, false);
    assert.match(ownerTarget.blockedReason ?? "", /transfer ownership/i);

    const memberTarget = buildProjectMemberMutationPolicy({
        actorIsOwner: true,
        ownerId: "owner-1",
        targetUserId: "member-1",
        targetRole: "member",
    });
    assert.equal(memberTarget.canPromoteToCoLeader, true);
    assert.equal(memberTarget.canRemove, true);
    assert.equal(memberTarget.canTransferOwnership, true);

    const nonOwnerActor = buildProjectMemberMutationPolicy({
        actorIsOwner: false,
        ownerId: "owner-1",
        targetUserId: "member-1",
        targetRole: "member",
    });
    assert.equal(nonOwnerActor.canRemove, false);
    assert.match(nonOwnerActor.blockedReason ?? "", /only the project owner/i);

    const coLeaderCanManageMember = buildProjectMemberMutationPolicy({
        actorIsOwner: false,
        actorRole: "admin",
        ownerId: "owner-1",
        targetUserId: "member-1",
        targetRole: "member",
        nextRole: "viewer",
    });
    assert.equal(coLeaderCanManageMember.canChangeRole, true);
    assert.equal(coLeaderCanManageMember.canRemove, true);

    const coLeaderCannotPromoteAdmin = buildProjectMemberMutationPolicy({
        actorIsOwner: false,
        actorRole: "admin",
        ownerId: "owner-1",
        targetUserId: "member-1",
        targetRole: "member",
        nextRole: "admin",
    });
    assert.equal(coLeaderCannotPromoteAdmin.canChangeRole, false);
    assert.match(coLeaderCannotPromoteAdmin.blockedReason ?? "", /Co-leaders can manage members and viewers/i);
});

test("project person resolver and removal preflight preserve former-member semantics", () => {
    assert.equal(getProjectMemberRoleLabel("admin"), "Co-leader");
    assert.equal(isAssignableProjectMember("viewer"), false);
    assert.equal(isEligibleProjectMember("viewer", "mention"), true);
    assert.equal(isEligibleProjectMember("viewer", "assign"), false);
    assert.equal(isEligibleProjectMember("admin", "review"), true);

    const former = buildProjectPersonReference({
        person: { id: "member-1", fullName: "Removed Person" },
        membershipRole: "member",
        isActiveMember: false,
    });
    assert.equal(former.state, "former_member");
    assert.equal(former.subtext, "Removed from project");
    assert.equal(former.isAssignable, false);

    const preflight = buildProjectMemberRemovalPreflight({
        member: { id: "member-1", fullName: "Removed Person", membershipRole: "member" },
        visibility: "private",
        activeAssignedTasks: 2,
        activeCreatedTasks: 1,
        fileReviews: 3,
        acceptedApplications: 1,
        projectGroupParticipant: true,
    });
    assert.equal(preflight.defaultMode, "preserve_history");
    assert.ok(preflight.warnings.some((warning) => warning.includes("Needs reassignment")));
    assert.ok(preflight.affectedAreas.some((area) => area.includes("Private project access is revoked")));
});

test("project danger preflight removes finalize and keeps archive/delete policy", () => {
    const policy = buildProjectSettingsPreflight({
        status: "active",
        openRolesCount: 2,
        pendingApplicationsCount: 1,
        activeTasksCount: 4,
        canArchive: true,
        canDelete: true,
    });

    assert.equal(policy.status, "active");
    assert.equal(policy.canArchive, true);
    assert.equal(policy.canDelete, true);
    assert.ok(policy.affectedAreas.includes("2 open roles"));
    assert.ok(policy.affectedAreas.includes("1 pending application"));
    assert.ok(policy.affectedAreas.includes("4 active tasks"));
    assert.ok(!("canFinalize" in policy));

    const missingServerPreflight = buildProjectSettingsPreflight(null);
    assert.equal(missingServerPreflight.canDelete, false);
});

test("project settings and create wizard share project category and info options", () => {
    assert.ok(isKnownProjectType("web_app"));
    assert.ok(isKnownProjectType(OTHER_PROJECT_TYPE_ID));
    assert.ok(PROJECT_TYPE_OPTIONS.some((option) => option.id === "side_project" && option.label === "Side Project"));
    assert.ok(POPULAR_PROJECT_TAGS.includes("AI/ML"));
    assert.ok(POPULAR_PROJECT_TECH.includes("Next.js"));
});

test("project metadata uses uploaded cover image for share previews", () => {
    const withCover = buildProjectDetailMetadataInput("network-for-builders", {
        slug: "network-for-builders",
        title: "Network for builders",
        coverImage: "https://cdn.example.test/network-cover.png",
    });
    assert.equal(withCover.image, "https://cdn.example.test/network-cover.png");

    const withoutCover = buildProjectDetailMetadataInput("network-for-builders", {
        slug: "network-for-builders",
        title: "Network for builders",
        coverImage: null,
    });
    assert.equal(withoutCover.image, "/api/og/project/network-for-builders");
});
