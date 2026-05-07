import assert from "node:assert/strict";
import test from "node:test";
import {
    buildProjectAccessPolicy,
    buildProjectRolePolicy,
    buildProjectSettingsPreflight,
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
