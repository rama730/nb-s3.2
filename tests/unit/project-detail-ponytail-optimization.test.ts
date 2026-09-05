import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

test("Domain A: Pruned 13 redundant indexes from schema/index.ts", () => {
  const schemaContent = readFileSync(resolve(ROOT, "src/lib/db/schema/index.ts"), "utf-8");

  // Pruned redundant indexes must NOT be present
  assert.doesNotMatch(schemaContent, /index\("idx_project_members_project"\)/);
  assert.doesNotMatch(schemaContent, /index\("idx_project_follows_project_id"\)/);
  assert.doesNotMatch(schemaContent, /index\("project_open_roles_project_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("tasks_project_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("tasks_deleted_at_partial_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("project_sprints_project_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("idx_task_subtasks_task_id"\)/);
  assert.doesNotMatch(schemaContent, /index\("idx_task_comments_task_id"\)/);
  assert.doesNotMatch(schemaContent, /index\("idx_project_nodes_project_id"\)/);
  assert.doesNotMatch(schemaContent, /index\("project_nodes_path_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("project_markdowns_project_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("project_updates_covering_feed_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("projects_created_at_idx"\)/);

  // Covering composite or unique indexes MUST be present
  assert.match(schemaContent, /projectUserUnique:\s*uniqueIndex/);
  assert.match(schemaContent, /uniqueFollow:\s*uniqueIndex/);
  assert.match(schemaContent, /projectUpdatedIdx:\s*index/);
  assert.match(schemaContent, /projectStatusIdx:\s*index/);
  assert.match(schemaContent, /projectNumberIdx:\s*uniqueIndex/);
  assert.match(schemaContent, /taskPositionIdx:\s*index/);
  assert.match(schemaContent, /createdAtIdx:\s*index/);
  assert.match(schemaContent, /listingIdx:\s*index/);
  assert.match(schemaContent, /projectSlugUnique:\s*uniqueIndex/);
  assert.match(schemaContent, /publicFeedIdx:\s*index/);
  assert.match(schemaContent, /createdAtStatusIdx:\s*index/);
});

test("Domain B: Task search query uses title GIN index without unindexed description ILIKE fallback", () => {
  const actionsContent = readFileSync(resolve(ROOT, "src/app/actions/project/_all.ts"), "utf-8");

  assert.doesNotMatch(actionsContent, /ilike\(t\.description,\s*searchPattern\)/);
  assert.match(actionsContent, /ilike\(t\.title,\s*searchPattern\)/);
});

test("Domain B: fetchProjectTasksForActor skips 4-table count CTE when surface is preview", () => {
  const actionsContent = readFileSync(resolve(ROOT, "src/app/actions/project/_all.ts"), "utf-8");

  assert.match(actionsContent, /const countRows = taskIds\.length === 0 \|\| surface === "preview"/);
});

test("Domain B: resolveProjectDetailTarget joins owner profile to eliminate shell waterfall", () => {
  const actionsContent = readFileSync(resolve(ROOT, "src/app/actions/project/_all.ts"), "utf-8");

  assert.match(actionsContent, /alias\(profiles,\s*"project_detail_owner_profiles"\)/);
  assert.match(actionsContent, /prefetchedOwner\?:/);
});

test("Domain C: Eliminates stats_invalidate broadcast storm loop", () => {
  const clientContent = readFileSync(
    resolve(ROOT, "src/components/projects/dashboard/ProjectDashboardClient.tsx"),
    "utf-8"
  );

  assert.doesNotMatch(clientContent, /stats_invalidate/);
  assert.doesNotMatch(clientContent, /statsChannelRef/);
  assert.doesNotMatch(clientContent, /subscribeProjectStats/);

  assert.match(clientContent, /const nextViews = payload\.new\?\.view_count;/);
  assert.match(clientContent, /const nextFollowers = payload\.new\?\.followers_count;/);
});

test("Domain D: Scopes refreshProjectData invalidation to active tabs", () => {
  const clientContent = readFileSync(
    resolve(ROOT, "src/components/projects/dashboard/ProjectDashboardClient.tsx"),
    "utf-8"
  );

  assert.match(clientContent, /const targetTab = scopeTab \|\| activeTab;/);
  assert.match(clientContent, /tasks: targetTab === .tasks. \|\| targetTab === .dashboard./);
  assert.match(clientContent, /sprints: targetTab === .sprints./);
});

test("Domain D: DocTab eliminates query waterfall when ?doc= search param is present", () => {
  const docTabContent = readFileSync(
    resolve(ROOT, "src/components/projects/tabs/DocTab.tsx"),
    "utf-8"
  );

  assert.match(docTabContent, /const paramDoc = searchParams\?\.get\("doc"\);/);
  assert.match(docTabContent, /if \(paramDoc\) return paramDoc;/);
});

test("Domain D: useProjectMembers configures gcTime for memory cleanup", () => {
  const hookContent = readFileSync(
    resolve(ROOT, "src/hooks/hub/useProjectMembers.ts"),
    "utf-8"
  );

  assert.match(hookContent, /gcTime: 1000 \* 60 \* 10/);
});

test("Domain E: ProjectLayout eliminates forced layout reflow from getBoundingClientRect", () => {
  const layoutContent = readFileSync(
    resolve(ROOT, "src/components/projects/dashboard/ProjectLayout.tsx"),
    "utf-8"
  );

  assert.doesNotMatch(layoutContent, /tabsRef\.current\?\.getBoundingClientRect\(\)\.height/);
  assert.match(layoutContent, /entries\[0\]\?\.contentRect/);
});

test("Domain E: ProjectStatsBar removes unused icon imports", () => {
  const statsBarContent = readFileSync(
    resolve(ROOT, "src/components/projects/ProjectStatsBar.tsx"),
    "utf-8"
  );

  assert.doesNotMatch(statsBarContent, /\bUsers\b/);
  assert.doesNotMatch(statsBarContent, /\bBookmark\b/);
  assert.match(statsBarContent, /import { TrendingUp } from "lucide-react";/);
});

test("Domain E: ProjectOverviewCard memoizes StatementBox and click handlers", () => {
  const overviewContent = readFileSync(
    resolve(ROOT, "src/components/projects/dashboard/ProjectOverviewCard.tsx"),
    "utf-8"
  );

  assert.match(overviewContent, /const StatementBox = memo\(function StatementBox/);
  assert.match(overviewContent, /handleOpenProblem = useCallback/);
  assert.match(overviewContent, /handleOpenSolution = useCallback/);
});

test("Domain G: Project page route consolidates viewer identity context", () => {
  const pageContent = readFileSync(
    resolve(ROOT, "src/app/(main)/projects/[slug]/page.tsx"),
    "utf-8"
  );

  assert.doesNotMatch(pageContent, /getViewerAuthContext/);
  assert.match(pageContent, /getViewerIdentityContext/);
  assert.match(pageContent, /const { viewerIdentity, result } = await readProjectRouteShell\(slug\);/);
});
