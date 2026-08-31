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
    projectUpdateDisplayText,
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

test("project update display text converts legacy reference tokens into readable labels", () => {
    const fileToken = '{% ref.files id="9a0966ed-c08c-4b52-98a1-3453fad1e26d" label="SECURITY.md" %}';
    const taskToken = '{% ref.tasks id="9fbd8943-e594-473c-8f82-5830851d1d7a" label="Task: Update the related files" %}';
    assert.equal(
        projectUpdateDisplayText(`hello ${fileToken} hope you like it`),
        "hello SECURITY.md hope you like it",
    );
    assert.equal(
        projectUpdateExcerpt(`${taskToken} we are working on this task`, 120),
        "Task: Update the related files we are working on this task",
    );
    assert.equal(
        projectUpdateExcerpt("{% project.tasks ids=\"task-1,task-2\" %}", 120),
        "Project tasks",
    );
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

test("project update media route caches immutable signed redirects", () => {
    const routeSource = readFileSync(path.join(process.cwd(), "src/app/api/v1/projects/[id]/update-media/route.ts"), "utf8");
    const accessSource = readFileSync(path.join(process.cwd(), "src/lib/data/project-access.ts"), "utf8");

    assert.match(routeSource, /SIGNED_URL_TTL_SECONDS = 15 \* 60/);
    assert.match(routeSource, /PRIVATE_REDIRECT_MAX_AGE_SECONDS = 12 \* 60/);
    assert.match(routeSource, /createSignedUrl\(storageKey, SIGNED_URL_TTL_SECONDS\)/);
    assert.match(routeSource, /publicTabVisibility: access\.project\.publicTabVisibility/);
    assert.match(routeSource, /"Vary", "Cookie, Authorization"/);
    assert.equal(routeSource.includes(".from(projects)"), false);
    assert.match(accessSource, /publicTabVisibility\?: unknown/);
    assert.match(accessSource, /publicTabVisibility: projects\.publicTabVisibility/);

    assert.match(routeSource, /: `private, max-age=\$\{PRIVATE_REDIRECT_MAX_AGE_SECONDS\}`/);
    assert.match(routeSource, /response\.headers\.set\("Cache-Control", cacheControl\)/);
    assert.match(routeSource, /if-none-match/);
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
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.indexes.includes("project_update_comments_parent_idx"), true);
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.indexes.includes("project_update_drafts_updated_at_idx"), true);
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.minPolicyCounts.project_updates, 3);
    assert.equal(PROJECT_UPDATE_SCHEMA_CONTRACT.minPolicyCounts.project_update_drafts, 1);
});

test("project update comment threading schema is present in baseline and repair migrations", () => {
    const schemaSource = readFileSync(path.join(process.cwd(), "src/lib/db/schema/index.ts"), "utf8");
    const baselineMigration = readFileSync(path.join(process.cwd(), "drizzle/0063_database_setup_authority_backfill.sql"), "utf8");
    const repairMigration = readFileSync(path.join(process.cwd(), "drizzle/0090_project_update_comment_threads.sql"), "utf8");
    const journal = readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8");

    assert.match(schemaSource, /parentId:\s*uuid\(["']parent_id["']\)/);
    assert.match(schemaSource, /project_update_comments_parent_idx/);
    assert.match(baselineMigration, /"parent_id"\s+uuid\s+REFERENCES\s+"project_update_comments"\("id"\)\s+ON DELETE set null/i);
    assert.match(baselineMigration, /project_update_comments_parent_idx/);
    assert.match(repairMigration, /ADD COLUMN IF NOT EXISTS "parent_id" uuid/);
    assert.match(repairMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE "project_update_comments"/);
    assert.match(journal, /0090_project_update_comment_threads/);
});

test("project update composer stores selected project records as structured refs", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/projects/updates/ProjectUpdateComposer.tsx"), "utf8");
    assert.match(source, /const addContextReference = \(/);
    assert.match(source, /addContextReference\("file", node\.id/);
    assert.equal(source.includes("buildInlineReadmeReference"), false);
    assert.equal(source.includes("setMentionPickerOpen"), false);
    assert.equal(source.includes("insertTextAtCursor(markdown"), false);
});

test("project update notifications avoid duplicate body and secondary text", () => {
    const actionSource = readFileSync(path.join(process.cwd(), "src/app/actions/project/updates.ts"), "utf8");
    const rowSource = readFileSync(path.join(process.cwd(), "src/components/notifications/NotificationRow.tsx"), "utf8");
    assert.match(actionSource, /function projectUpdateNotificationBody/);
    assert.match(actionSource, /body: notificationBody/);
    assert.match(actionSource, /secondaryText: null/);
    assert.match(rowSource, /secondaryText !== bodyText/);
    assert.match(rowSource, /projectUpdateDisplayText/);
});

test("updates tab loads feed data once from the client-owned query path", () => {
    const pageSource = readFileSync(path.join(process.cwd(), "src/app/(main)/projects/[slug]/page.tsx"), "utf8");
    const actionSource = readFileSync(path.join(process.cwd(), "src/app/actions/project/updates.ts"), "utf8");

    assert.equal(pageSource.includes("readProjectUpdatesAction"), false);
    assert.equal(pageSource.includes("initialUpdatesPage="), false);
    assert.equal(actionSource.includes("function readProjectUpdateMovementSummary"), false);
    assert.match(actionSource, /movementSummary:\s*null/);
});

test("project update draft hydration does not immediately autosave an unchanged empty draft", () => {
    const composerSource = readFileSync(path.join(process.cwd(), "src/components/projects/updates/ProjectUpdateComposer.tsx"), "utf8");

    assert.match(composerSource, /let initialContent = ""/);
    assert.match(composerSource, /let initialVisibility: ProjectUpdateVisibility = "public"/);
    assert.match(composerSource, /lastSavedDraftRef\.current = JSON\.stringify\(\{/);
    assert.match(composerSource, /content: initialContent/);
    assert.match(composerSource, /visibility: initialVisibility/);
    assert.match(composerSource, /entityRefs: initialEntityRefs/);
    assert.match(composerSource, /media: initialMedia/);
});

test("project update comments share one project-scoped wildcard postgres binding", () => {
    const tabSource = readFileSync(path.join(process.cwd(), "src/components/projects/tabs/UpdatesTab.tsx"), "utf8");
    const subscriptionsSource = readFileSync(path.join(process.cwd(), "src/lib/realtime/subscriptions.ts"), "utf8");

    assert.equal(tabSource.includes('(["INSERT", "UPDATE", "DELETE"] as const).map'), false);
    assert.match(tabSource, /event: "\*"/);
    assert.match(tabSource, /table: "project_update_comments"/);
    assert.match(tabSource, /filter: `project_id=eq\.\$\{projectId\}`/);
    assert.match(tabSource, /resourceId: `updates:\$\{projectId\}`/);
    assert.match(subscriptionsSource, /const groupedBindings = new Map<string, ActiveResourceBinding\[\]>\(\)/);
    assert.match(subscriptionsSource, /const event = grouped\.length === 1 \? firstBinding\.event : "\*"/);
});

test("project update likes persist counters synchronously", () => {
    const actionSource = readFileSync(path.join(process.cwd(), "src/app/actions/project/updates.ts"), "utf8");

    assert.match(actionSource, /export async function toggleProjectUpdateLikeAction/);
    assert.match(actionSource, /\.update\(projectUpdates\)/);
    assert.match(actionSource, /returning\(\{ likeCount: projectUpdates\.likeCount \}\)/);
    assert.equal(actionSource.includes("project:updates:likes"), false);
    assert.equal(actionSource.includes("redis.hincrby"), false);
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
    assert.match(railSource, /updateRelativeTime\(update\.createdAt, "long"\)/);
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
    assert.equal(composerSource.includes("selectedReferences"), false);
    assert.match(composerSource, /normalizeProjectUpdateReferences\(entityRefs\.references\)/);
    assert.match(composerSource, /references: normalizeProjectUpdateReferences\(entityRefs\.references\)/);
    assert.match(composerSource, /ProjectUpdateMediaFrame/);
    assert.match(composerSource, /isProjectUpdateVideoMedia\(item\)/);
    assert.match(composerSource, /src=\{item\.previewUrl\}/);
    assert.match(composerSource, /src=\{item\.url\}/);
    assert.match(composerSource, /handleImageFiles\(event\.dataTransfer\.files\)/);
    assert.match(composerSource, /selectedFiles\.slice\(0, remainingSlots\)/);
    assert.equal(composerSource.includes("EMPTY_SELECTED_CONTEXT"), false);
});

test("updates feed and detail render context references and actual images", () => {
    const tabSource = readFileSync(path.join(process.cwd(), "src/components/projects/tabs/UpdatesTab.tsx"), "utf8");
    const mediaFrameSource = readFileSync(path.join(process.cwd(), "src/components/projects/updates/ProjectUpdateMediaFrame.tsx"), "utf8");
    const referenceLinkStart = tabSource.indexOf("function ReferenceLink");
    const rendererStart = tabSource.indexOf("function UpdateContextAndMedia");
    const cardStart = tabSource.indexOf("function UpdateCard");
    const detailStart = tabSource.indexOf("function UpdateDetailPanel");
    assert.notEqual(referenceLinkStart, -1);
    assert.notEqual(rendererStart, -1);
    assert.notEqual(cardStart, -1);
    assert.notEqual(detailStart, -1);

    const referenceLinkSource = tabSource.slice(referenceLinkStart, rendererStart);
    const clickableReferenceStart = referenceLinkSource.indexOf("return (\n    <a");
    const clickableReferenceEnd = referenceLinkSource.indexOf("</a>", clickableReferenceStart);
    assert.notEqual(clickableReferenceStart, -1);
    assert.notEqual(clickableReferenceEnd, -1);
    const clickableReferenceSource = referenceLinkSource.slice(clickableReferenceStart, clickableReferenceEnd);
    const rendererSource = tabSource.slice(rendererStart, cardStart);
    const cardSource = tabSource.slice(cardStart, detailStart);
    const detailSource = tabSource.slice(detailStart);

    assert.match(tabSource, /type UpdateReferenceLinkKind = "task" \| "sprint" \| "file"/);
    assert.match(tabSource, /function normalizeUpdateReferenceLinkKind/);
    assert.match(tabSource, /if \(kind === "file"\) return `\/projects\/\$\{slug\}\?tab=files&fileId=\$\{id\}`/);
    assert.match(tabSource, /update\.context\.references/);
    assert.match(tabSource, /update\.context\.task/);
    assert.match(referenceLinkSource, /resolveProjectUpdateMentionTargetAction/);
    assert.match(referenceLinkSource, /referenceFallbackHref/);
    assert.match(referenceLinkSource, /const normalizedKind = normalizeUpdateReferenceLinkKind\(reference\.kind\)/);
    assert.match(referenceLinkSource, /kind: normalizedKind/);
    assert.match(clickableReferenceSource, /href=\{fallbackHref\}/);
    assert.match(clickableReferenceSource, /hover:underline/);
    assert.equal(clickableReferenceSource.includes("bg-blue-50"), false);
    assert.equal(clickableReferenceSource.includes("rounded"), false);
    assert.equal(clickableReferenceSource.includes("border"), false);
    assert.equal(tabSource.includes("getBreadcrumbs("), false);
    assert.match(rendererSource, /item\.type === "image"/);
    assert.match(rendererSource, /ProjectUpdateMediaFrame/);
    assert.match(rendererSource, /ProjectUpdateMediaViewer/);
    assert.match(rendererSource, /setViewerMedia\(item\)/);
    assert.equal(rendererSource.includes("href={item.url}"), false);
    assert.match(rendererSource, /isProjectUpdateVideoMedia\(item\)/);
    assert.match(rendererSource, /inline-flex min-w-0 items-center text-sm font-medium text-blue-600/);
    assert.equal(rendererSource.includes("rounded-xl border border-zinc-200 px-3 py-2"), false);
    assert.match(rendererSource, /mt-2 space-y-2/);
    assert.match(mediaFrameSource, /data-project-update-media-frame="true"/);
    assert.match(mediaFrameSource, /data-media-orientation=\{orientation\}/);
    assert.match(mediaFrameSource, /onOpen\?: \(\) => void/);
    assert.match(mediaFrameSource, /type="button"/);
    assert.match(mediaFrameSource, /return "10 \/ 16"/);
    assert.match(mediaFrameSource, /if \(!ratio\) return "portrait"/);
    assert.match(mediaFrameSource, /return "portrait"/);
    assert.match(mediaFrameSource, /max-w-\[320px\]/);
    assert.equal(mediaFrameSource.includes("square"), false);
    assert.equal(mediaFrameSource.includes("max-w-[360px]"), false);
    assert.equal(mediaFrameSource.includes("max-w-[420px]"), false);
    assert.equal(mediaFrameSource.includes("max-w-[560px]"), false);
    assert.match(mediaFrameSource, /object-cover object-center/);
    assert.match(mediaFrameSource, /data-media-load-state=\{loadState\}/);
    assert.match(mediaFrameSource, /onLoad=\{\(\) => setLoadState\("ready"\)\}/);
    assert.match(mediaFrameSource, /onLoadedData=\{\(\) => setLoadState\("ready"\)\}/);
    assert.match(mediaFrameSource, /Loading media/);
    assert.equal(mediaFrameSource.includes("mx-auto"), false);
    assert.equal(mediaFrameSource.includes("w-fit"), false);
    assert.equal(rendererSource.includes("UpdateContextIcon"), false);
    assert.match(cardSource, /<ProjectUpdateContent/);
    assert.match(detailSource, /<ProjectUpdateContent/);
    assert.match(cardSource, /<UpdateContextAndMedia update=\{update\} \/>/);
    assert.match(cardSource, /border-b border-zinc-200 px-1 py-3/);
    assert.match(tabSource, /const UPDATE_CARD_CONTROL_SELECTOR/);
    assert.match(tabSource, /const control = target\.closest\(UPDATE_CARD_CONTROL_SELECTOR\)/);
    assert.match(tabSource, /control && control !== card/);
    assert.match(cardSource, /role="button"/);
    assert.match(cardSource, /tabIndex=\{isEditing \? -1 : 0\}/);
    assert.match(cardSource, /isEditing \|\| event\.defaultPrevented \|\| isUpdateCardControl\(event\.target, event\.currentTarget\)/);
    assert.match(cardSource, /onOpenDetail\(update\.id\)/);
    assert.match(cardSource, /!isEditing && "cursor-pointer hover:bg-zinc-50\/70/);
    assert.match(cardSource, /size=\{40\}/);
    assert.match(cardSource, /gap-x-1\.5 gap-y-0\.5 text-\[15px\] leading-5/);
    assert.match(cardSource, /className="mt-1 block w-full whitespace-pre-wrap/);
    assert.doesNotMatch(cardSource, /<div\s+role="button"/);
    assert.match(cardSource, /text-\[15px\] leading-5 text-zinc-800/);
    assert.match(cardSource, /mt-2 flex items-center gap-6 text-sm leading-5 text-zinc-500/);
    assert.match(detailSource, /<UpdateContextAndMedia update=\{update\} \/>/);
    assert.match(detailSource, /py-4 pr-1/);
    assert.match(detailSource, /border-b border-zinc-200 pb-4/);
    assert.match(detailSource, /size=\{40\}/);
    assert.match(detailSource, /mt-1 whitespace-pre-wrap break-words text-\[15px\] leading-5/);
    assert.match(detailSource, /mt-2 flex items-center gap-6 text-sm leading-5 text-zinc-500/);
    assert.equal(cardSource.includes("Object.entries(update.context"), false);
    assert.equal(cardSource.includes("Object.values(update.context"), false);
});

test("project update comments and replies use the compact feed conversation layout", () => {
    const tabSource = readFileSync(path.join(process.cwd(), "src/components/projects/tabs/UpdatesTab.tsx"), "utf8");
    const commentRowStart = tabSource.indexOf("function CommentRow");
    const updateCommentsStart = tabSource.indexOf("function UpdateComments");
    const updateCardStart = tabSource.indexOf("function UpdateCard");
    assert.notEqual(commentRowStart, -1);
    assert.notEqual(updateCommentsStart, -1);
    assert.notEqual(updateCardStart, -1);

    const commentRowSource = tabSource.slice(commentRowStart, updateCommentsStart);
    const updateCommentsSource = tabSource.slice(updateCommentsStart, updateCardStart);

    assert.match(commentRowSource, /relative flex gap-2\.5 rounded-md px-1 py-1/);
    assert.match(tabSource, /function ThreadAvatarRail/);
    assert.match(tabSource, /function ThreadRailBridge/);
    assert.match(commentRowSource, /<ThreadAvatarRail incoming=\{!isFirst\} outgoing=\{!isLast\}>/);
    assert.equal(tabSource.includes("-z-10 left-[15px]"), false);
    assert.match(commentRowSource, /flex flex-wrap items-baseline gap-x-1\.5 gap-y-0\.5 text-\[13px\] leading-4/);
    assert.match(commentRowSource, /mt-0\.5 whitespace-pre-wrap break-words text-\[14px\] leading-5/);
    assert.match(commentRowSource, /mt-0\.5 flex items-center gap-4 text-xs font-medium leading-4/);
    assert.match(commentRowSource, /mt-1\.5 flex gap-2/);
    assert.match(commentRowSource, /size=\{24\}/);
    assert.equal(commentRowSource.includes("rounded-2xl bg-zinc-50 px-3 py-2"), false);
    assert.equal(commentRowSource.includes("mt-1 whitespace-pre-wrap break-words text-sm"), false);

    assert.match(updateCommentsSource, /rounded-md transition-colors duration-200/);
    assert.match(updateCommentsSource, /bg-blue-50\/60 px-2 py-1 dark:bg-blue-950\/20/);
    assert.match(updateCommentsSource, /mt-2 flex min-h-0 flex-col border-t/);
    assert.match(updateCommentsSource, /min-h-0 flex-1 space-y-0\.5 overflow-y-auto/);
    assert.match(updateCommentsSource, /mb-1\.5 mt-1\.5 flex shrink-0 gap-2 pl-10/);
    assert.match(updateCommentsSource, /mb-2 flex shrink-0 gap-2/);
    assert.match(updateCommentsSource, /size=\{28\}/);
    assert.match(updateCommentsSource, /h-9 min-w-0 flex-1/);
    assert.match(updateCommentsSource, /h-9 shrink-0 animate-pulse rounded-full/);
    assert.match(updateCommentsSource, /min-h-0 flex-1 space-y-1\.5 overflow-y-auto/);
    assert.equal(updateCommentsSource.includes("rounded-2xl bg-zinc-50 px-3 py-2"), false);
    assert.equal(updateCommentsSource.includes("mt-1 whitespace-pre-wrap break-words text-sm"), false);
});

test("project updates use the feed icon in project navigation", () => {
    const layoutSource = readFileSync(path.join(process.cwd(), "src/components/projects/dashboard/ProjectLayout.tsx"), "utf8");

    assert.match(layoutSource, /\{ id: "updates", label: "Updates", icon: Newspaper \}/);
    assert.equal(layoutSource.includes('icon: Megaphone'), false);
});

test("project update backend treats references as first-class linked work", () => {
    const actionsSource = readFileSync(path.join(process.cwd(), "src/app/actions/project/updates.ts"), "utf8");

    assert.match(actionsSource, /const refs = normalizeEntityRefs\(row\.entityRefs\)/);
    assert.match(actionsSource, /for \(const reference of refs\.references \?\? \[\]\)/);
    assert.match(actionsSource, /if \(reference\.kind === "task"\) taskIds\.add\(reference\.id\)/);
    assert.match(actionsSource, /shouldNotifyProjectUpdateFollowers\(\{ content, entityRefs, media \}\)/);
    assert.match(actionsSource, /const hasReferences = normalizeProjectUpdateReferences\(entityRefs\.references\)\.length > 0/);
    assert.match(actionsSource, /!content\.trim\(\) && !hasReferences && media\.length === 0/);
    assert.match(actionsSource, /export async function resolveProjectUpdateMentionTargetAction/);
    assert.match(actionsSource, /function projectSprintHref/);
    assert.match(actionsSource, /function encodeProjectNodePath/);
    assert.match(actionsSource, /function projectFileHref\(project: \{ id: string; slug: string \| null \}, row: \{ id: string; path: string \| null; name: string \}\)/);
    assert.match(actionsSource, /const fileId = encodeURIComponent\(row\.id\)/);
    assert.match(actionsSource, /tab=files&fileId=\$\{fileId\}&path=\$\{encodedPath\}/);
    assert.match(actionsSource, /pathParts\.map\(\(part\) => encodeURIComponent\(part\)\)\.join\("\/"\)/);
    assert.match(actionsSource, /canReadProjectUpdateTargetTab/);
    assert.equal(actionsSource.includes("encodeURIComponent(pathOrName)"), false);
});

test("project update file mentions survive the dashboard and Files V3 handoff", () => {
    const dashboardSource = readFileSync(path.join(process.cwd(), "src/components/projects/dashboard/ProjectDashboardClient.tsx"), "utf8");
    const tabsRegistrySource = readFileSync(path.join(process.cwd(), "src/components/projects/dashboard/ProjectTabsRegistry.tsx"), "utf8");
    const filesRootSource = readFileSync(path.join(process.cwd(), "src/components/projects/v2/files-tab/FilesTabRoot.tsx"), "utf8");

    assert.match(dashboardSource, /const initialOpenFileId = searchParams\?\.get\('fileId'\) \|\| null/);
    assert.match(dashboardSource, /initialOpenFileId=\{initialOpenFileId\}/);
    assert.match(tabsRegistrySource, /files-tab\/FilesTabRoot/);
    assert.match(filesRootSource, /initialOpenFileId\?: string \| null/);
    assert.match(filesRootSource, /const navigateToInitialFile = useNavigateTo\(projectId\)/);
    assert.match(filesRootSource, /getNodeMetadataBatch\(projectId, \[initialOpenFileId\], \{ includeBreadcrumbs: true \}\)/);
    assert.match(filesRootSource, /upsertNodes\(projectId, result\.data\.nodes\)/);
    assert.match(filesRootSource, /handledInitialFileIdRef/);
    assert.match(filesRootSource, /nodesById\[initialOpenFileId\]\?\.type === "file"/);
    assert.match(filesRootSource, /navigateToInitialFile\(initialOpenFileId\)/);
    assert.match(filesRootSource, /stage: initialOpenFileId \? "diagnostics" : stage/);
});

test("project update task mentions keep retrying until the task panel opens", () => {
    const tasksTabSource = readFileSync(path.join(process.cwd(), "src/components/projects/v2/TasksTab.tsx"), "utf8");

    assert.match(tasksTabSource, /const loadingInitialOpenTaskRef = useRef<string \| null>\(null\)/);
    assert.match(tasksTabSource, /if \(loadingInitialOpenTaskRef\.current === initialOpenTaskId\) return/);
    assert.match(tasksTabSource, /handledInitialOpenTaskRef\.current = initialOpenTaskId;\s*\n\s*openTask\(localTask, initialPanelTab(?:, true)?\);\s*\n\s*onInitialTaskOpened\?\.\(\)/);
    assert.match(tasksTabSource, /handledInitialOpenTaskRef\.current = initialOpenTaskId;\s*\n\s*openTask\(normalizedTask, initialPanelTab(?:, true)?\);\s*\n\s*onInitialTaskOpened\?\.\(\)/);
    assert.equal(
        /handledInitialOpenTaskRef\.current = initialOpenTaskId;\s*\n\s*const localTask/.test(tasksTabSource),
        false,
        "TasksTab must not mark the deep-link request handled before a local or fetched task actually opens",
    );
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
