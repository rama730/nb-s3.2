import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("development and realtime launchers reference only live runtimes", () => {
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
  const devSource = read("scripts/dev.ts");
  const invokedScripts = Array.from(devSource.matchAll(/args:\s*\['run',\s*'([^']+)'\]/g), (match) => match[1]);

  assert.deepEqual(invokedScripts, ["yjs:dev"]);
  for (const script of invokedScripts) {
    assert.ok(scripts[script!], `scripts/dev.ts invokes missing package script ${script}`);
  }

  const runtimeSources = [
    devSource,
    read("scripts/run-e2e-with-prod-server.ts"),
    read("scripts/check-stability-env.ts"),
    read("scripts/check-api-versioning-contract.ts"),
    read("scripts/run-load-suite.ts"),
  ].join("\n");

  assert.doesNotMatch(runtimeSources, /presence:dev|services\/presence|presence-token|PRESENCE_WS|PRESENCE_TOKEN_SECRET|presence-room-fanout/);
  assert.match(read("src/lib/realtime/presence-client.ts"), /config:\s*\{\s*presence:\s*\{\s*key:/);
  assert.doesNotMatch(read("src/app/api/v1/presence/heartbeat/route.ts"), /presence:live-session:/);
});
