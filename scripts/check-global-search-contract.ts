import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const schema = source("src/lib/db/schema/index.ts");
const hubAction = source("src/app/actions/hub.ts");
const connectionsAction = source("src/app/actions/connections.ts");
const taskAction = source("src/app/actions/project/_all.ts");
const observability = source("src/lib/search/observability.ts");
const previewHook = source("src/hooks/useGlobalSearchPreviews.ts");
const commandPalette = source("src/components/layout/header/CommandPalette.tsx");
const topNav = source("src/components/layout/header/TopNav.tsx");
const searchContract = source("src/components/layout/header/global-search.ts");
const resultCards = source("src/components/layout/header/GlobalSearchResultCards.tsx");
const hubData = source("src/lib/data/hub.ts");

const requiredIndexes = [
  "projects_title_search_idx",
  "projects_description_search_idx",
  "profiles_username_search_idx",
  "profiles_full_name_search_idx",
  "tasks_project_idx",
  "tasks_title_search_idx",
  "tasks_project_number_idx",
];

for (const indexName of requiredIndexes) {
  assert.match(schema, new RegExp(indexName), `Missing global-search index contract: ${indexName}`);
}

assert.match(hubAction, /surface: 'full' \| 'preview'/);
assert.match(hubAction, /hubSearchInputSchema\.safeParse/);
assert.match(connectionsAction, /includeMeta: z\.boolean\(\)\.optional\(\)/);
assert.doesNotMatch(connectionsAction, /filters: z\.any|historyFilters: z\.any/);
assert.match(connectionsAction, /accepted_connection\.status = 'accepted'/);
assert.match(connectionsAction, /blocked_connection\.status = 'blocked'/);
assert.match(connectionsAction, /applySuggestedProfilePrivacy\(user\.id, items\)/);
assert.match(taskAction, /surface: 'full' \| 'preview'/);
assert.match(previewHook, /queryKeys\.globalSearch\.preview/);
assert.match(previewHook, /userId: profile\.id/);
assert.match(commandPalette, /useConnectionMutations\(\)/);
assert.match(commandPalette, /data-testid="global-search-enter-hint"/);
assert.match(commandPalette, /const palettePlaceholder = `Search \$\{presentation\.label\}\.\.\.`/);
assert.match(commandPalette, /Recent searches/);
assert.match(commandPalette, /readRecentGlobalSearches/);
assert.match(commandPalette, /rememberRecentGlobalSearch/);
assert.match(commandPalette, /rememberRecentGlobalSearchPreview/);
assert.match(commandPalette, /removeRecentGlobalSearch/);
assert.match(commandPalette, /Remove \$\{recent\.label\} from recent searches/);
assert.match(commandPalette, /sm:group-hover:opacity-100/);
assert.doesNotMatch(commandPalette, /<DialogHeader|ContextIcon|ChevronLeft/);
assert.doesNotMatch(commandPalette, /↑↓.*Navigate|Search all “|Enter a search term/);
assert.match(topNav, /recentSearchOwnerId=\{user\?\.id\}/);
assert.match(searchContract, /MAX_RECENT_GLOBAL_SEARCHES = 5/);
assert.match(searchContract, /nb:global-search:recent:v1/);
assert.match(searchContract, /kind: "preview"/);
assert.match(searchContract, /preview:\$\{preview\.id\}/);
assert.match(searchContract, /searchParams\.get\("tech"\)/);
assert.match(searchContract, /params\.delete\("tech"\)/);
assert.match(resultCards, /result\.connectionStatus === "none" && result\.canConnect/);
assert.match(previewHook, /debouncedQuery\.length >= 2/);
assert.doesNotMatch(observability, /queryText|rawQuery|searchText/);
assert.doesNotMatch(observability, /query:\s*metric/);
assert.match(hubData, /row_number\(\) over/);
assert.match(hubData, /lte\(rankedConnectedMembers\.connectionRank, 3\)/);
assert.match(hubData, /eq\(connections\.status, 'accepted'\)/);
assert.match(hubData, /connectedFriend/);
assert.match(hubData, /acceptedRoleTitle/);
assert.match(hubData, /roleApplications/);
assert.match(hubData, /connectionRank/);
assert.match(hubData, /connectedCount/);
assert.match(hubData, /getProjectMemberRoleLabel/);

console.log(`Global-search contract passed (${requiredIndexes.length} required indexes, bounded previews, strict inputs, redacted metrics).`);
