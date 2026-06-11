import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES,
    PROJECT_UPDATE_FILTERS,
    PROJECT_UPDATE_MAX_MEDIA_ITEMS,
    PROJECT_UPDATE_MAX_REFERENCES,
    PROJECT_UPDATE_MEDIA_BUCKET,
    PROJECT_UPDATE_MEDIA_MAX_BYTES,
    PROJECT_UPDATE_SCHEMA_CONTRACT,
    PROJECT_UPDATE_TYPE_LABELS,
    composeProjectUpdateRoleLabel,
    isProjectUpdateType,
    isSafeProjectUpdateUrl,
    normalizeProjectUpdateAuthorRoleSnapshot,
    normalizeProjectUpdateMediaItems,
    normalizeProjectUpdateFilter,
    normalizeProjectUpdateReferences,
    normalizeProjectUpdateType,
    projectUpdateImageExtensionFromMimeType,
    projectUpdateDraftStorageKey,
    projectUpdateExcerpt,
    resolveProjectUpdateAuthorRoleDisplay,
    sanitizeProjectUpdateContent,
    sanitizeProjectUpdateRoleTitle,
    shouldNotifyProjectUpdateFollowers,
} from "../../src/lib/projects/updates";

test("project update types and filters expose the locked product labels", () => {
    assert.equal(PROJECT_UPDATE_TYPE_LABELS.progress, "Progress");
    assert.equal(PROJECT_UPDATE_TYPE_LABELS.milestone, "Milestone");
    assert.equal(PROJECT_UPDATE_TYPE_LABELS.release, "Release");
    assert.equal(PROJECT_UPDATE_TYPE_LABELS.blocker, "Blocker");
    assert.equal(PROJECT_UPDATE_TYPE_LABELS.decision, "Decision");
    assert.equal(PROJECT_UPDATE_TYPE_LABELS.collaboration_request, "Collaboration request");
    assert.equal(PROJECT_UPDATE_TYPE_LABELS.behind_the_scenes, "Behind the scenes");
    assert.deepEqual(PROJECT_UPDATE_FILTERS.map((filter) => filter.id), [
        "all",
        "progress",
        "milestone",
        "release",
        "blocker",
        "decision",
    ]);
});

test("project update normalization fails closed for unknown types and filters", () => {
    assert.equal(isProjectUpdateType("progress"), true);
    assert.equal(isProjectUpdateType("on_track"), false);
    assert.equal(isProjectUpdateType("at_risk"), false);
    assert.equal(isProjectUpdateType("status"), false);
    assert.equal(normalizeProjectUpdateType("release"), "release");
    assert.equal(normalizeProjectUpdateType("unknown"), null);
    assert.equal(normalizeProjectUpdateFilter("blocker"), "blocker");
    assert.equal(normalizeProjectUpdateFilter("behind_the_scenes"), "behind_the_scenes");
    assert.equal(normalizeProjectUpdateFilter("unknown"), "all");
    assert.equal(normalizeProjectUpdateFilter(null), "all");
});

test("project update content and excerpts are bounded for feed and notification surfaces", () => {
    assert.equal(sanitizeProjectUpdateContent("  shipped beta  "), "shipped beta");
    assert.equal(sanitizeProjectUpdateContent(42), "");
    assert.equal(sanitizeProjectUpdateContent("abcdef", 4), "abcd");
    assert.equal(projectUpdateExcerpt("Alpha\n\nBeta   Gamma", 40), "Alpha Beta Gamma");
    assert.equal(projectUpdateExcerpt("A long update body", 8), "A long…");
});

test("project update notification signal avoids noisy follower fanout", () => {
    assert.equal(shouldNotifyProjectUpdateFollowers({ content: "tiny" }), false);
    assert.equal(shouldNotifyProjectUpdateFollowers({ content: "We finished the first integration pass and merged the end-to-end update flow." }), true);
    assert.equal(shouldNotifyProjectUpdateFollowers({ content: "Linked task", entityRefs: { taskId: "task-1" } }), true);
    assert.equal(shouldNotifyProjectUpdateFollowers({ content: "Linked sprint", entityRefs: { references: [{ kind: "sprint", id: "sprint-1" }] } }), true);
    assert.equal(shouldNotifyProjectUpdateFollowers({ content: "Link", media: [{ type: "link", url: "https://example.com" }] }), true);
});

test("project update media normalization keeps only safe public links", () => {
    assert.equal(isSafeProjectUpdateUrl("https://example.com/demo"), true);
    assert.equal(isSafeProjectUpdateUrl("/api/v1/projects/project-1/update-media?key=abc"), true);
    assert.equal(isSafeProjectUpdateUrl("blob:https://example.com/demo"), false);
    assert.equal(isSafeProjectUpdateUrl("javascript:alert(1)"), false);
    assert.deepEqual(normalizeProjectUpdateMediaItems([
        { type: "link", url: "https://example.com/demo", label: "Demo" },
        {
            type: "image",
            url: "/api/v1/projects/project-1/update-media?key=projects/project-1/update-media/user-1/demo.png",
            label: "Demo image",
            altText: "Screenshot",
            mimeType: "image/png",
            size: 2048,
            width: 1200,
            height: 800,
            bucket: PROJECT_UPDATE_MEDIA_BUCKET,
            storageKey: "projects/project-1/update-media/user-1/demo.png",
        },
        { type: "link", url: "javascript:alert(1)", label: "Unsafe" },
        { type: "unknown", url: "https://example.com/nope" },
    ]), [
        {
            type: "link",
            url: "https://example.com/demo",
            label: "Demo",
            altText: null,
            mimeType: null,
            size: null,
            width: null,
            height: null,
            bucket: null,
            storageKey: null,
        },
        {
            type: "image",
            url: "/api/v1/projects/project-1/update-media?key=projects/project-1/update-media/user-1/demo.png",
            label: "Demo image",
            altText: "Screenshot",
            mimeType: "image/png",
            size: 2048,
            width: 1200,
            height: 800,
            bucket: PROJECT_UPDATE_MEDIA_BUCKET,
            storageKey: "projects/project-1/update-media/user-1/demo.png",
        },
    ]);
});

test("project update references and image upload contracts stay bounded", () => {
    assert.deepEqual(normalizeProjectUpdateReferences([
        { kind: "task", id: " task-1 " },
        { kind: "task", id: "task-1" },
        { kind: "sprint", id: "sprint-1" },
        { kind: "file", id: "file-1" },
        { kind: "readme", id: "readme-1" },
        { kind: "file", id: "" },
    ]), [
        { kind: "task", id: "task-1" },
        { kind: "sprint", id: "sprint-1" },
        { kind: "file", id: "file-1" },
    ]);
    assert.equal(normalizeProjectUpdateReferences(
        Array.from({ length: PROJECT_UPDATE_MAX_REFERENCES + 2 }, (_, index) => ({ kind: "task", id: `task-${index}` })),
    ).length, PROJECT_UPDATE_MAX_REFERENCES);
    assert.equal(PROJECT_UPDATE_MAX_MEDIA_ITEMS, 4);
    assert.equal(PROJECT_UPDATE_MEDIA_MAX_BYTES, 8 * 1024 * 1024);
    assert.equal(PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES.has("image/png"), true);
    assert.equal(PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES.has("image/svg+xml"), false);
    assert.equal(projectUpdateImageExtensionFromMimeType("image/png"), "png");
    assert.equal(projectUpdateImageExtensionFromMimeType("image/webp"), "webp");
    assert.equal(projectUpdateImageExtensionFromMimeType("image/gif"), "gif");
    assert.equal(projectUpdateImageExtensionFromMimeType("image/jpeg"), "jpg");
});

test("project update draft and schema contracts are stable", () => {
    assert.equal(projectUpdateDraftStorageKey("project-1", "user-1"), "nb.project-updates.draft.project-1.user-1");
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.tables.includes("project_updates"), true);
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.tables.includes("project_update_drafts"), true);
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.indexes.includes("project_updates_project_pinned_created_idx"), true);
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.indexes.includes("project_update_drafts_updated_at_idx"), true);
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.minPolicyCounts.project_updates, 3);
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.minPolicyCounts.project_update_drafts, 1);
});

test("project update author roles compose membership and current project position", () => {
    assert.equal(sanitizeProjectUpdateRoleTitle("  Lead   Front-end Developer  "), "Lead Front-end Developer");
    assert.equal(composeProjectUpdateRoleLabel({ roleTitle: "Front-end Developer", membershipRoleLabel: "Lead" }), "Lead Front-end Developer");
    assert.equal(composeProjectUpdateRoleLabel({ roleTitle: "UX Designer", membershipRoleLabel: "Co-lead" }), "Co-lead UX Designer");
    assert.equal(composeProjectUpdateRoleLabel({ roleTitle: "Lead Designer", membershipRoleLabel: "Lead" }), "Lead Designer");
    const snapshot = normalizeProjectUpdateAuthorRoleSnapshot({
        roleTitle: "Front-end Developer",
        membershipRoleLabel: "Lead",
        source: "project_role",
        capturedAt: "2026-06-06T00:00:00.000Z",
    });
    assert.deepEqual(resolveProjectUpdateAuthorRoleDisplay({
        snapshot,
        projectRoleTitle: "Product Designer",
        membershipRoleLabel: "Member",
    }), {
        roleLabel: "Lead Product Designer",
        roleTitle: "Product Designer",
        membershipRoleLabel: "Lead",
        roleSource: "project_role",
    });
    assert.deepEqual(resolveProjectUpdateAuthorRoleDisplay({
        snapshot: null,
        projectRoleTitle: "UX Designer",
        membershipRoleLabel: "Member",
    }), {
        roleLabel: "UX Designer",
        roleTitle: "UX Designer",
        membershipRoleLabel: "Member",
        roleSource: "project_role",
    });
    assert.deepEqual(resolveProjectUpdateAuthorRoleDisplay({
        snapshot: normalizeProjectUpdateAuthorRoleSnapshot({
            displayRoleLabel: "Lead",
            roleTitle: "Lead",
            membershipRoleLabel: "Lead",
            source: "membership",
            capturedAt: "2026-06-06T00:00:00.000Z",
        }),
        projectRoleTitle: "Front-end Developer",
        membershipRoleLabel: "Lead",
    }), {
        roleLabel: "Lead Front-end Developer",
        roleTitle: "Front-end Developer",
        membershipRoleLabel: "Lead",
        roleSource: "project_role",
    });
});

test("project update author roles repair stale open-role snapshots with authoritative project roles", () => {
    assert.deepEqual(resolveProjectUpdateAuthorRoleDisplay({
        snapshot: normalizeProjectUpdateAuthorRoleSnapshot({
            displayRoleLabel: "Lead Full Stack Developer",
            roleTitle: "Full Stack Developer",
            membershipRoleLabel: "Lead",
            source: "project_role",
            capturedAt: "2026-06-06T00:00:00.000Z",
        }),
        projectRoleTitle: "Frontend Product Designer",
        membershipRoleLabel: "Lead",
    }), {
        roleLabel: "Lead Frontend Product Designer",
        roleTitle: "Frontend Product Designer",
        membershipRoleLabel: "Lead",
        roleSource: "project_role",
    });
});

test("updates tab right rail stays a shortcut index instead of a duplicate feed", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/projects/tabs/UpdatesTab.tsx"), "utf8");
    const railStart = source.indexOf("function UpdatesRightRail");
    const detailStart = source.indexOf("function UpdateDetailPanel");
    assert.notEqual(railStart, -1);
    assert.notEqual(detailStart, -1);

    const railSource = source.slice(railStart, detailStart);
    assert.match(railSource, /Update shortcuts/);
    assert.match(railSource, /postingMembers/);
    assert.match(railSource, /latestByAuthor/);
    assert.match(railSource, /updateAuthorRoleLabel/);
    assert.match(railSource, /updateShortcutTime/);
    assert.match(railSource, /truncate text-sm/);
    assert.equal(railSource.includes("RIGHT_RAIL_PREVIEW_LIMIT"), false);
    assert.equal(railSource.includes("View all updates"), false);
    assert.equal(railSource.includes("Write first update"), false);
    assert.equal(railSource.includes("likeCount"), false);
    assert.equal(railSource.includes("commentCount"), false);
    assert.equal(railSource.includes("updatePreviewText"), false);
    assert.equal(railSource.includes("line-clamp"), false);
    assert.equal(railSource.includes("Latest project posts from the team."), false);

    [
        "Movement",
        "Moving today",
        "Follower signal",
        "Contributor momentum",
        "Visitor view",
        "Latest movement",
        "Linked work",
        "Publishing guidance",
        "Work links",
        "movement.pulse",
    ].forEach((copy) => {
        assert.equal(railSource.includes(copy), false, `${copy} should not render in the default updates rail`);
    });
});

test("updates tab owns one composer placement and refreshes realtime posts directly", () => {
    const tabSource = readFileSync(path.join(process.cwd(), "src/components/projects/tabs/UpdatesTab.tsx"), "utf8");
    const composerSource = readFileSync(path.join(process.cwd(), "src/components/projects/updates/ProjectUpdateComposer.tsx"), "utf8");

    assert.match(tabSource, /useDesktopUpdatesRail/);
    assert.match(tabSource, /isDesktopUpdatesRail === false/);
    assert.match(tabSource, /isDesktopUpdatesRail === true/);
    assert.match(tabSource, /invalidateQueries\(\{ queryKey: updatesQueryKey \}\)/);
    assert.equal(tabSource.includes("New updates available"), false);
    assert.equal(tabSource.includes("newUpdatesAvailable"), false);
    assert.equal(tabSource.includes("composerOpenSignal"), false);
    assert.equal(tabSource.includes("onWriteFirstUpdate"), false);
    assert.equal(tabSource.includes("onViewAll"), false);
    assert.equal(composerSource.includes("openSignal"), false);
});

test("project update composer renders structured context and image media before posting", () => {
    const composerSource = readFileSync(path.join(process.cwd(), "src/components/projects/updates/ProjectUpdateComposer.tsx"), "utf8");

    assert.match(composerSource, /ImagePlus/);
    assert.match(composerSource, /createProjectUpdateMediaUploadUrlAction/);
    assert.match(composerSource, /finalizeProjectUpdateMediaUploadAction/);
    assert.match(composerSource, /uploadToSupabaseSignedUrl/);
    assert.match(composerSource, /PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES/);
    assert.match(composerSource, /PROJECT_UPDATE_MEDIA_MAX_BYTES/);
    assert.match(composerSource, /pendingMediaUploads/);
    assert.match(composerSource, /selectedReferences/);
    assert.match(composerSource, /normalizeProjectUpdateReferences\(entityRefs\.references\)/);
    assert.match(composerSource, /references: normalizeProjectUpdateReferences\(entityRefs\.references\)/);
    assert.match(composerSource, /<img src=\{item\.previewUrl\}/);
    assert.match(composerSource, /<img src=\{item\.url\}/);
    assert.match(composerSource, /handleImageFiles\(event\.dataTransfer\.files\)/);
    assert.match(composerSource, /selectedFiles\.slice\(0, remainingSlots\)/);
    assert.equal(composerSource.includes("EMPTY_SELECTED_CONTEXT"), false);
});

test("updates feed and detail render context references and actual images", () => {
    const tabSource = readFileSync(path.join(process.cwd(), "src/components/projects/tabs/UpdatesTab.tsx"), "utf8");
    const rendererStart = tabSource.indexOf("function UpdateContextAndMedia");
    const cardStart = tabSource.indexOf("function UpdateCard");
    const detailStart = tabSource.indexOf("function UpdateDetailPanel");
    assert.notEqual(rendererStart, -1);
    assert.notEqual(cardStart, -1);
    assert.notEqual(detailStart, -1);

    const rendererSource = tabSource.slice(rendererStart, cardStart);
    const cardSource = tabSource.slice(cardStart, detailStart);
    const detailSource = tabSource.slice(detailStart);

    assert.match(tabSource, /update\.context\.references/);
    assert.match(tabSource, /update\.context\.task/);
    assert.match(rendererSource, /item\.type === "image"/);
    assert.match(rendererSource, /<img/);
    assert.match(rendererSource, /loading="lazy"/);
    assert.match(rendererSource, /decoding="async"/);
    assert.match(rendererSource, /UpdateContextIcon/);
    assert.match(cardSource, /<UpdateContextAndMedia update=\{update\} \/>/);
    assert.match(detailSource, /<UpdateContextAndMedia update=\{update\} \/>/);
    assert.equal(cardSource.includes("Object.entries(update.context"), false);
    assert.equal(cardSource.includes("Object.values(update.context"), false);
});

test("project update backend treats references as first-class linked work", () => {
    const actionsSource = readFileSync(path.join(process.cwd(), "src/app/actions/project/updates.ts"), "utf8");

    assert.match(actionsSource, /COALESCE\(\$\{projectUpdates\.entityRefs\}->'references', '\[\]'::jsonb\) @> '\[\{"kind":"task"\}\]'::jsonb/);
    assert.match(actionsSource, /COALESCE\(\$\{projectUpdates\.entityRefs\}->'references', '\[\]'::jsonb\) @> '\[\{"kind":"sprint"\}\]'::jsonb/);
    assert.match(actionsSource, /COALESCE\(\$\{projectUpdates\.entityRefs\}->'references', '\[\]'::jsonb\) @> '\[\{"kind":"file"\}\]'::jsonb/);
    assert.match(actionsSource, /const hasReferences = normalizeProjectUpdateReferences\(entityRefs\.references\)\.length > 0/);
    assert.match(actionsSource, /!content\.trim\(\) && !hasReferences && media\.length === 0/);
});

test("updates tab right rail consumes the full remaining desktop width", () => {
    const tabSource = readFileSync(path.join(process.cwd(), "src/components/projects/tabs/UpdatesTab.tsx"), "utf8");

    assert.match(tabSource, /xl:grid-cols-\[minmax\(0,760px\)_minmax\(0,1fr\)\]/);
    assert.match(tabSource, /2xl:grid-cols-\[minmax\(0,820px\)_minmax\(0,1fr\)\]/);
    assert.match(tabSource, /hidden w-full min-w-0 self-stretch xl:block/);
    assert.match(tabSource, /sticky top-4 .* w-full overflow-y-auto/);
    assert.equal(tabSource.includes("minmax(320px,420px)"), false);
    assert.equal(tabSource.includes("_420px"), false);
});
