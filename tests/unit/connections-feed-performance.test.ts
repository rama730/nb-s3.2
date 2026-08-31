import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("connections feed shares auth, overlaps reads, and keeps privacy auditing off the response path", () => {
  const action = source("src/app/actions/connections.ts");
  const feedImpl = action.slice(
    action.indexOf("async function getConnectionsFeedImpl"),
    action.indexOf("export async function getConnectionsFeed(input"),
  );

  assert.doesNotMatch(feedImpl, /const user = await getAuthUser\(\)/);
  assert.match(feedImpl, /const statsPromise: Promise<ConnectionsFeedStats>/);
  assert.match(feedImpl, /after\(async \(\) =>/);
  assert.match(feedImpl, /logger\.metric\('connections\.feed'/);
  assert.match(action, /runInFlightDeduped\(dedupeKey, \(\) => getConnectionsFeedImpl\(input, user\)\)/);
});

test("People lazily loads inactive tabs and has a route-level loading shell", () => {
  const hub = source("src/components/people/PeopleHubClient.tsx");
  const loading = source("src/app/(main)/people/loading.tsx");

  assert.match(hub, /const loadPeopleClient = \(\) => import\("@\/components\/people\/PeopleClient"\)/);
  assert.match(hub, /const loadConnectionsClient = \(\) => import\("@\/components\/people\/ConnectionsClient"\)/);
  assert.match(hub, /const loadRequestsTab = \(\) => import\("@\/components\/people\/RequestsTab"\)/);
  assert.match(hub, /dynamic\(loadPeopleClient/);
  assert.match(hub, /dynamic\(loadConnectionsClient/);
  assert.match(hub, /dynamic\(loadRequestsTab/);
  assert.match(hub, /onMouseEnter=\{\(\) => preloadTab\(t\.key\)\}/);
  assert.doesNotMatch(hub, /import PeopleClient from/);
  assert.match(loading, /aria-label="Loading connections"/);
});
