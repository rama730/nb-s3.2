import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("people notification counts use one authenticated action and query key", () => {
  const provider = source("src/components/providers/PeopleNotificationsProvider.tsx");
  const actions = source("src/app/actions/connections.ts");

  assert.match(provider, /readPeoplePendingCountsAction/);
  assert.match(provider, /queryKeys\.connections\.pending\(\)/);
  assert.doesNotMatch(provider, /createSupabaseBrowserClient|\.from\("connections"\)/);
  assert.match(actions, /export async function readPeoplePendingCountsAction/);
  assert.match(actions, /messageWorkflowItems\.kind, 'project_invite'/);
});
