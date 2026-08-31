import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

describe("workspace drawer contracts", () => {
  it("uses the same incoming application source and row as Connections", () => {
    const requests = read("src/components/workspace/WorkspaceRequestsTab.tsx");
    const drawer = read("src/components/workspace/WorkspaceDrawer.tsx");

    assert.match(requests, /IncomingProjectApplicationRow/);
    assert.match(requests, /RequestProfileRow/);
    assert.match(requests, /usePendingRequests\(20, isWorkspaceOpen && isActive, \{ includeSent: false \}\)/);
    assert.match(requests, /app\.isWorkflowItem/);
    assert.match(requests, /queryKeys\.workspace\.joinRequests\(\)/);
    assert.match(requests, /getIncomingApplicationsAction\(\{ limit: 20 \}\)/);
    assert.match(requests, /View all requests/);
    assert.match(drawer, /getWorkspaceSummaryAction/);
    assert.match(drawer, /queryKeys\.workspace\.summary\(\)/);
  });

  it("keeps task scope, status, and search filters in one overflow menu", () => {
    const tasks = read("src/components/workspace/WorkspaceTasksTab.tsx");
    const drawer = read("src/components/workspace/WorkspaceDrawer.tsx");

    assert.match(tasks, /DropdownMenuTrigger asChild/);
    assert.match(tasks, /aria-label="Filter workspace tasks"/);
    assert.match(tasks, /DropdownMenuRadioGroup/);
    assert.match(tasks, /MoreHorizontal/);
    assert.match(tasks, /z-\[202\]/);
    assert.match(tasks, /index === 0 \? taskFiltersMenu : null/);
    assert.doesNotMatch(tasks, /absolute right-0 top-0/);
    assert.match(tasks, /resetScope = \(nextScope: WorkspaceScope\)/);
    assert.match(tasks, /queryKeys\.workspace\.tasks\(scope, limit\)/);
    assert.match(tasks, /My tasks/);
    assert.match(tasks, /Team tasks/);
    assert.match(tasks, /All open work/);
    assert.match(tasks, /useState<WorkspaceScope>\("all"\)/);
    assert.match(tasks, /OPEN_STATUSES/);
    assert.match(tasks, /TASK_STATUS_PRESENTATION/);
    assert.match(tasks, /Search tasks or projects/);
    assert.doesNotMatch(tasks, /Virtuoso/);
  });

  it("opens workspace tasks through the project panel without exposing drawer IDs", () => {
    const tasks = read("src/components/workspace/WorkspaceTasksTab.tsx");
    const store = read("src/lib/stores/ui-store.ts");
    const dashboard = read("src/components/projects/dashboard/ProjectDashboardClient.tsx");

    assert.match(tasks, /createWorkspaceTaskHandoff\(projectId, task\.id\)/);
    assert.match(tasks, /setWorkspaceTaskHandoff\(handoff\)/);
    assert.match(tasks, /WORKSPACE_TASK_HANDOFF_STORAGE_KEY/);
    assert.match(tasks, /setWorkspaceOpen\(false\)/);
    assert.match(tasks, /router\.push\(`\/projects\/\$\{projectIdentifier\}\?tab=tasks`\)/);
    assert.doesNotMatch(tasks, /drawerType=task&drawerId=/);
    assert.doesNotMatch(tasks, /router\.prefetch/);
    assert.match(store, /workspaceTaskHandoff/);
    assert.match(dashboard, /initialTaskDrawerId \?\? workspaceInitialTaskId/);
    assert.match(dashboard, /onInitialTaskOpened=\{workspaceInitialTaskId \? consumeWorkspaceTaskHandoff : undefined\}/);
    assert.match(dashboard, /Keep the handoff alive until TasksTab has actually opened the panel/);
    assert.match(dashboard, /sessionTaskHandoff/);
    assert.match(dashboard, /readWorkspaceTaskHandoff/);
    assert.match(store, /WORKSPACE_TASK_HANDOFF_MAX_AGE_MS/);
  });

  it("shows owner and member project tasks in team and all scopes", () => {
    const workspace = read("src/app/actions/workspace.ts");

    assert.match(workspace, /const visibleProjectCheck = exists/);
    assert.match(workspace, /eq\(projects\.ownerId, user\.id\)/);
    assert.match(workspace, /eq\(projectMembers\.userId, user\.id\)/);
    assert.match(workspace, /or\(isNull\(tasks\.assigneeId\), ne\(tasks\.assigneeId, user\.id\)\)/);
    assert.match(workspace, /scopeWhere = visibleProjectCheck/);
    assert.match(workspace, /scope: "my" \| "team" \| "all" = "all"/);
  });

  it("keeps workspace refreshes scoped to task and request notifications", () => {
    const provider = read("src/components/providers/PeopleNotificationsProvider.tsx");

    assert.match(provider, /WORKSPACE_NOTIFICATION_KINDS/);
    assert.match(provider, /event\.kind !== "notification"/);
    assert.match(provider, /task_assigned/);
    assert.match(provider, /application_received/);
    assert.match(provider, /connection_request_received/);
    assert.match(provider, /queryKeys\.workspace\.root\(\)/);
    assert.match(provider, /workspaceInvalidationDomains/);
    assert.match(provider, /pendingInvalidationDomainsRef/);
  });

  it("uses shared lifecycle rows with contextual request controls", () => {
    const row = read("src/components/people/IncomingProjectApplicationRow.tsx");
    const requests = read("src/components/workspace/WorkspaceRequestsTab.tsx");

    assert.match(row, /Project invitation/);
    assert.match(row, /formatDistanceToNowStrict/);
    assert.match(row, /aria-label=\{`Accept/);
    assert.match(requests, /removeOptimistically/);
    assert.match(requests, /queryKeys\.notifications\.root\(\)/);
  });
});

it("keeps the drawer state and deep links on the same two-tab contract", () => {
  const drawer = read("src/components/workspace/WorkspaceDrawer.tsx");
  const host = read("src/components/workspace/WorkspaceDrawerHost.tsx");
  const store = read("src/lib/stores/ui-store.ts");

  assert.match(drawer, /role="tab"/);
  assert.match(drawer, /aria-selected/);
  assert.match(drawer, /id="workspace-drawer"/);
  assert.match(host, /setWorkspaceOpen\(true\)/);
  assert.match(host, /workspaceTab/);
  assert.match(host, /workspaceDeepLink/);
  assert.match(host, /router\.replace/);
  assert.match(host, /usePathname/);
  assert.match(host, /setWorkspaceOpen, setWorkspaceTab, workspaceDeepLink/);
  assert.match(store, /export type WorkspaceTab = "tasks" \| "requests"/);
});

it("uses the shared drawer motion contract and concise workspace naming", () => {
  const drawer = read("src/components/workspace/WorkspaceDrawer.tsx");
  const host = read("src/components/workspace/WorkspaceDrawerHost.tsx");
  const indicator = read("src/components/layout/header/WorkspaceIndicator.tsx");

  assert.match(drawer, /presentation="right-drawer"/);
  assert.match(drawer, /<DialogTitle[^>]*>\s*Workspace/);
  assert.match(host, /const \[hasMounted, setHasMounted\]/);
  assert.match(host, /return hasMounted \? <WorkspaceDrawer \/> : null/);
  assert.match(indicator, />\s*Workspace\s*</);
  assert.doesNotMatch(indicator, /PanelRightOpen/);
});

it("keeps actionable workspace state visible without task-tab scaffolding", () => {
  const indicator = read("src/components/layout/header/WorkspaceIndicator.tsx");
  const tasks = read("src/components/workspace/WorkspaceTasksTab.tsx");
  const drawer = read("src/components/workspace/WorkspaceDrawer.tsx");

  assert.match(indicator, /getWorkspaceSummaryAction/);
  assert.match(indicator, /usePeopleNotifications/);
  assert.match(indicator, /summary\.taskCount \+ summary\.requestCount \+ pendingConnections/);
  assert.match(indicator, /text-rose-600/);
  assert.match(indicator, /actionCount/);
  assert.match(drawer, /usePeopleNotifications/);
  assert.match(drawer, /summary\.requestCount : 0\) \+ pendingConnections/);
  assert.match(drawer, /needsAttention/);
  assert.match(drawer, /text-rose-500/);
  assert.match(drawer, /bg-rose-100/);
  assert.doesNotMatch(tasks, />Workspace Tasks</);
  assert.match(tasks, /groups\.map\(\(group, index\)/);
  assert.match(tasks, /API's urgency-aware task order/);
  assert.match(tasks, /grid-cols-1 gap-2 min-\[600px\]:grid-cols-2/);
  assert.match(tasks, /Load more tasks/);
  assert.match(drawer, /px-6 pb-6 pt-2/);
});
