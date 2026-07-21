import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { settingsTabHref } from "@/constants/routes";
import {
  buildGlobalSearchClearHref,
  buildGlobalSearchHref,
  getGlobalSearchQuery,
  getGlobalSearchRecentScope,
  getProjectIdentifierFromPathname,
  isProjectDetailPath,
  mergeRecentGlobalSearches,
  readRecentGlobalSearches,
  removeRecentGlobalSearch,
  rememberRecentGlobalSearch,
  rememberRecentGlobalSearchPreview,
  resolveGlobalSearchContext,
  searchSettings,
  type RecentGlobalSearchItem,
} from "@/components/layout/header/global-search";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("top-nav routes use tabbed settings and correctly classify project detail routes", () => {
  assert.equal(settingsTabHref("notifications"), "/settings?tab=notifications");
  assert.equal(isProjectDetailPath("/projects/new"), false);
  assert.equal(isProjectDetailPath("/projects/deepscope-ai"), true);
  assert.equal(getProjectIdentifierFromPathname("/projects/deepscope-ai"), "deepscope-ai");
  assert.equal(getProjectIdentifierFromPathname("/projects/new"), null);
  assert.equal(resolveGlobalSearchContext("/projects/new").context, "default");
  assert.equal(resolveGlobalSearchContext("/projects/deepscope-ai").context, "project");
  assert.equal(resolveGlobalSearchContext("/settings").context, "settings");
  assert.equal(resolveGlobalSearchContext("/messages").context, "messages");
});

test("global-search preserves unrelated filters and only resets task pagination", () => {
  assert.equal(
    buildGlobalSearchClearHref({
      pathname: "/hub",
      searchParams: new URLSearchParams("q=react&tech=GitHub&type=startup&sort=popular"),
      context: "hub",
    }),
    "/hub?type=startup&sort=popular",
  );
  assert.equal(
    buildGlobalSearchClearHref({
      pathname: "/projects/deepscope-ai",
      searchParams: new URLSearchParams("tab=docs&search=design&page=4"),
      context: "project",
    }),
    "/projects/deepscope-ai?tab=docs&page=4",
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/projects/deepscope-ai",
      searchParams: new URLSearchParams("tab=docs&page=4"),
      context: "project",
      query: "roadmap",
    }),
    "/projects/deepscope-ai?tab=tasks&page=1&search=roadmap",
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/people",
      searchParams: new URLSearchParams("tab=requests"),
      context: "people",
      query: "TypeScript",
    }),
    "/people?tab=discover&q=TypeScript",
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/people",
      searchParams: new URLSearchParams("tab=network"),
      context: "people",
      query: "Ramanayudu",
    }),
    "/people?tab=network&q=Ramanayudu",
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/messages",
      searchParams: new URLSearchParams(),
      context: "messages",
      query: "roadmap",
    }),
    null,
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/profile",
      searchParams: new URLSearchParams("edit=true"),
      context: "default",
      query: "design systems",
    }),
    "/hub?q=design+systems",
  );
});

test("global-search exposes and clears selected Hub technologies", () => {
  assert.equal(getGlobalSearchQuery(new URLSearchParams("tech=GitHub"), "hub"), "GitHub");
  assert.equal(getGlobalSearchQuery(new URLSearchParams("tech=GitHub,React"), "hub"), "GitHub, React");
  assert.equal(getGlobalSearchQuery(new URLSearchParams("q=pony&tech=GitHub"), "hub"), "pony");
  assert.equal(
    buildGlobalSearchClearHref({
      pathname: "/hub",
      searchParams: new URLSearchParams("tech=GitHub&type=startup"),
      context: "hub",
    }),
    "/hub?type=startup",
  );
});

test("recent global searches are scoped, deduplicated, and bounded", () => {
  assert.equal(getGlobalSearchRecentScope("default", "discover", null), "hub");
  assert.equal(getGlobalSearchRecentScope("hub", "discover", null), "hub");
  assert.equal(getGlobalSearchRecentScope("people", "network", null), "people:network");
  assert.equal(getGlobalSearchRecentScope("project", "discover", "deepscope-ai"), "project:deepscope-ai");
  const query = (value: string): RecentGlobalSearchItem => ({ kind: "query", key: `query:${value.toLowerCase()}`, label: value, query: value });
  assert.deepEqual(mergeRecentGlobalSearches([query("React"), query("GitHub")], query("react")), [query("react"), query("GitHub")]);
  assert.deepEqual(mergeRecentGlobalSearches(["a", "b", "c", "d", "e"].map(query), query("f")), ["f", "a", "b", "c", "d"].map(query));
});

test("recent global-search storage isolates users and contexts and tolerates malformed data", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });

  try {
    rememberRecentGlobalSearch("alice", "hub", "React");
    rememberRecentGlobalSearch("alice", "hub", "GitHub");
    rememberRecentGlobalSearch("alice", "people:discover", "Lakshmi");
    rememberRecentGlobalSearch("bob", "hub", "Supabase");

    assert.deepEqual(readRecentGlobalSearches("alice", "hub").map((item) => item.label), ["GitHub", "React"]);
    assert.deepEqual(readRecentGlobalSearches("alice", "people:discover").map((item) => item.label), ["Lakshmi"]);
    assert.deepEqual(readRecentGlobalSearches("bob", "hub").map((item) => item.label), ["Supabase"]);
    assert.deepEqual(readRecentGlobalSearches("", "hub"), []);

    assert.deepEqual(removeRecentGlobalSearch("alice", "hub", "query:github").map((item) => item.label), ["React"]);
    assert.deepEqual(readRecentGlobalSearches("alice", "hub").map((item) => item.label), ["React"]);
    assert.deepEqual(removeRecentGlobalSearch("alice", "people:discover", "missing").map((item) => item.label), ["Lakshmi"]);

    const preview = { id: "project:ponytail", title: "Ponytail", kind: "project" as const, href: "/projects/ponytail" };
    rememberRecentGlobalSearchPreview("alice", "hub", preview);
    const selected = readRecentGlobalSearches("alice", "hub")[0];
    assert.equal(selected?.kind, "preview");
    assert.equal(selected?.label, "Ponytail");
    assert.deepEqual(selected?.kind === "preview" ? selected.preview : null, preview);

    storage.set("nb:global-search:recent:v1:broken", "{");
    assert.deepEqual(readRecentGlobalSearches("broken", "hub"), []);

    storage.set("nb:global-search:recent:v1:legacy", JSON.stringify({ hub: ["React"] }));
    assert.equal(readRecentGlobalSearches("legacy", "hub")[0]?.label, "React");
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("settings search resolves user intent to the canonical tabbed settings route", () => {
  assert.equal(searchSettings("change color theme")[0]?.id, "theme");
  assert.equal(searchSettings("VS Code disconnect")[0]?.href, "/settings?tab=integrations");
  assert.equal(searchSettings("").length, 6);
});

test("top-nav keeps one accessible, route-aligned implementation", () => {
  const topNav = source("src/components/layout/header/TopNav.tsx");
  const navLink = source("src/components/layout/header/NavLink.tsx");
  const mobileMenu = source("src/components/layout/header/MobileMenu.tsx");
  const notifications = source("src/components/layout/header/NotificationPreview.tsx");
  const runtime = source("src/components/providers/MainRuntimeProviders.tsx");
  const realtime = source("src/lib/realtime/subscriptions.ts");
  const chat = source("src/components/chat/ChatProvider.tsx");
  const layout = source("src/components/layout/MainLayout.tsx");
  const notificationActions = source("src/app/actions/notifications.ts");
  const messages = source("src/components/chat/v2/MessagesWorkspaceV2.tsx");
  const people = source("src/components/people/PeopleHubClient.tsx");
  const discoverPeople = source("src/components/people/PeopleClient.tsx");
  const networkPeople = source("src/components/people/ConnectionsClient.tsx");
  const taskAction = source("src/app/actions/project/_all.ts");
  const commandPalette = source("src/components/layout/header/CommandPalette.tsx");
  const globalSearch = source("src/components/layout/header/GlobalSearch.tsx");
  const globalSearchContract = source("src/components/layout/header/global-search.ts");
  const searchPreviews = source("src/hooks/useGlobalSearchPreviews.ts");
  const connectionsHook = source("src/hooks/useConnections.ts");
  const connectionsAction = source("src/app/actions/connections.ts");
  const personCard = source("src/components/people/PersonCard.tsx");
  const resultCards = source("src/components/layout/header/GlobalSearchResultCards.tsx");
  const hubData = source("src/lib/data/hub.ts");

  assert.match(topNav, /e\.key\.toLowerCase\(\) === "k"/);
  assert.match(topNav, /OPEN_MESSAGES_SEARCH_EVENT/);
  assert.match(topNav, /MAIN_NAV_ITEMS/);
  assert.match(topNav, /hidden min-w-0 flex-1 items-center justify-end gap-4 md:flex/);
  assert.match(topNav, /className="flex shrink-0 items-center gap-1"/);
  assert.match(topNav, /recentSearchOwnerId=\{user\?\.id\}/);
  assert.match(navLink, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(mobileMenu, /<Dialog open=\{props\.isOpen\}/);
  assert.match(notifications, /href=\{settingsTabHref\("notifications"\)\}/);
  assert.match(notifications, /isMarkingAllRead/);
  assert.match(runtime, /<PeopleNotificationsProvider>/);
  assert.doesNotMatch(runtime, /PresencePublisher|startPresenceHeartbeat/);
  assert.match(realtime, /resourceType: 'profile'/);
  assert.doesNotMatch(realtime, /table: 'tasks'/);
  assert.match(chat, /usePublishOnlinePresence\(\)/);
  assert.match(layout, /WorkspaceDrawerHost/);
  assert.match(messages, /open-messages-local-search|OPEN_MESSAGES_SEARCH_EVENT/);
  assert.match(people, /searchParams\?\.get\("q"\)/);
  assert.match(people, /searchQuery=\{routeQuery\}/);
  assert.doesNotMatch(discoverPeople, /type="search"|Search people by name/);
  assert.doesNotMatch(networkPeople, /type="search"|Search your connections/);
  assert.match(taskAction, /project-task-search/);
  assert.match(taskAction, /ilike\(t\.title, searchPattern\)/);
  assert.match(commandPalette, /Skills in these projects/);
  assert.match(commandPalette, /<SkillIcon skill=\{resolveClientSkill\(result\.title\)\}/);
  assert.match(commandPalette, /<AppScrollArea axis="x" variant="hidden"/);
  assert.match(commandPalette, /shrink-0 items-center/);
  assert.match(commandPalette, /<form onSubmit=\{handleSubmit\} className="flex min-h-0 min-w-0/);
  assert.match(commandPalette, /Builder search results/);
  assert.match(commandPalette, /Task search results/);
  assert.match(commandPalette, /SearchSkeletons/);
  assert.match(commandPalette, /Search is temporarily paused/);
  assert.match(commandPalette, /h-dvh w-screen/);
  assert.match(commandPalette, /aria-activedescendant/);
  assert.match(commandPalette, /data-testid="global-search-enter-hint"/);
  assert.match(commandPalette, /const palettePlaceholder = `Search \$\{presentation\.label\}\.\.\.`/);
  assert.match(commandPalette, /normalizedQuery \? \(/);
  assert.match(commandPalette, /<kbd>Esc<\/kbd>/);
  assert.match(commandPalette, /Recent searches/);
  assert.match(commandPalette, /readRecentGlobalSearches/);
  assert.match(commandPalette, /rememberRecentGlobalSearch/);
  assert.match(commandPalette, /rememberRecentGlobalSearchPreview/);
  assert.match(commandPalette, /removeRecentGlobalSearch/);
  assert.match(commandPalette, /Remove \$\{recent\.label\} from recent searches/);
  assert.match(commandPalette, /sm:group-hover:opacity-100/);
  assert.doesNotMatch(commandPalette, /<DialogHeader|ContextIcon|ChevronLeft/);
  assert.match(commandPalette, /press Enter to run the full search/);
  assert.doesNotMatch(commandPalette, /↑↓.*Navigate|Search all “|Enter a search term/);
  assert.match(globalSearch, /h-10 w-60/);
  assert.doesNotMatch(globalSearch, /hover:w-/);
  assert.match(globalSearchContract, /searchParams\.get\("tech"\)/);
  assert.match(globalSearchContract, /params\.delete\("tech"\)/);
  assert.match(globalSearchContract, /MAX_RECENT_GLOBAL_SEARCHES = 5/);
  assert.match(globalSearchContract, /nb:global-search:recent:v1/);
  assert.match(resultCards, /ProjectSearchResultCard/);
  assert.match(resultCards, /ProfileSearchResultCard/);
  assert.match(resultCards, /Connect with \$\{result\.title\}/);
  assert.match(resultCards, /result\.connectionStatus === "none" && result\.canConnect/);
  assert.match(commandPalette, /useConnectionMutations\(\)/);
  assert.match(commandPalette, /getConnectionRequestSuccessMessage/);
  assert.match(searchPreviews, /userId: profile\.id/);
  assert.match(connectionsHook, /queryKeys\.globalSearch\.peopleRoot\(\)/);
  assert.match(discoverPeople, /getConnectionRequestSuccessMessage/);
  assert.match(resultCards, /TaskSearchResultCard/);
  assert.match(resultCards, /SettingsSearchResultCard/);
  assert.match(resultCards, /SkillIconRail/);
  assert.match(resultCards, /border-zinc-300 bg-zinc-50 shadow-sm/);
  assert.doesNotMatch(resultCards, /border-primary\/25 bg-primary/);
  assert.doesNotMatch(resultCards, /FolderKanban/);
  assert.doesNotMatch(resultCards, /taskCode\.split/);
  assert.doesNotMatch(resultCards, /identity=\{result\.assignee\}/);
  assert.doesNotMatch(resultCards, /h-7 w-7 items-center justify-center rounded-md border/);
  assert.doesNotMatch(resultCards, /rounded-md bg-zinc-100 px-1 text-\[10px\].*\+\{hidden\}/);
  assert.match(resultCards, /followersCount\.toLocaleString\(\).*following/);
  assert.match(resultCards, /viewCount\.toLocaleString\(\)/);
  assert.match(resultCards, /connectedFriends\.map/);
  assert.match(resultCards, /more connection/);
  assert.match(hubData, /row_number\(\) over/);
  assert.match(hubData, /lte\(rankedConnectedMembers\.connectionRank, 3\)/);
  assert.match(hubData, /eq\(connections\.status, 'accepted'\)/);
  assert.match(hubData, /connectedFriend/);
  assert.match(hubData, /acceptedRoleTitle/);
  assert.match(hubData, /Lead \/ /);
  assert.match(hubData, /connectionRank/);
  assert.match(searchPreviews, /fetchHubProjectsAction/);
  assert.match(searchPreviews, /getConnectionsFeed/);
  assert.match(searchPreviews, /fetchProjectTaskPreviewsAction/);
  assert.match(connectionsAction, /accepted_connection\.status = 'accepted'/);
  assert.match(connectionsAction, /blocked_connection\.status = 'blocked'/);
  assert.match(connectionsAction, /applySuggestedProfilePrivacy\(user\.id, items\)/);
  assert.match(personCard, /onDismiss && status === "none"/);
  assert.match(searchPreviews, /useDebounce\(normalizeGlobalSearchQuery\(query\), 300\)/);
  assert.match(searchPreviews, /debouncedQuery\.length >= 2/);
  assert.match(searchPreviews, /previewContext === "hub" \? 60_000/);
  assert.match(searchPreviews, /queryKeys\.globalSearch\.preview/);
  assert.match(searchPreviews, /isDebouncing/);
  assert.match(searchPreviews, /refetchOnWindowFocus: false/);
  assert.match(taskAction, /fetchProjectTasksForActor/);
  assert.match(taskAction, /projectTaskPreviewInputSchema/);
  assert.match(taskAction, /taskNumberSearch/);
  assert.doesNotMatch(searchPreviews, /fetch\("\/api\//);
  assert.match(connectionsAction, /jsonb_array_elements_text/);
  assert.match(connectionsAction, /jsonb_typeof\(\$\{profiles\.skills\}\) = 'array'/);
  assert.doesNotMatch(connectionsAction, /profiles\.skills\}::text\[\]/);
  assert.match(connectionsAction, /Search must cover every eligible profile/);
  assert.match(connectionsAction, /isNull\(profiles\.deletedAt\)/);
  assert.match(connectionsAction, /searchFallbackNextCursor/);
  assert.match(connectionsAction, /idColumn: profiles\.id/);
  assert.doesNotMatch(connectionsAction, /filters: z\.any|historyFilters: z\.any/);
  assert.doesNotMatch(topNav, /target instanceof HTMLInputElement/);
  assert.doesNotMatch(notificationActions, /@\/app\/actions\/messaging\/_all/);
  assert.equal(fs.existsSync(path.join(process.cwd(), "src/components/layout/MobileNav.tsx")), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), "src/components/layout/header/ProfileMenu.tsx")), false);
});
