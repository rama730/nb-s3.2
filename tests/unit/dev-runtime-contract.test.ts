import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("development launches the web runtime directly and references only live runtimes", () => {
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
  const devSource = read("scripts/dev.ts");
  const invokedScripts = Array.from(devSource.matchAll(/args:\s*\['run',\s*'([^']+)'\]/g), (match) => match[1]);

  assert.match(scripts.dev, /^next dev --turbo$/, "the default dev command must launch only the web server");
  assert.equal(scripts["dev:collab"], undefined, "removed collaboration runtimes must not remain launchable");
  assert.match(
    read("next.config.ts"),
    /turbopackFileSystemCacheForDev:\s*false/,
    "the dev server must not run filesystem-cache compaction during interactive work",
  );
  assert.deepEqual(invokedScripts, []);
  for (const script of invokedScripts) {
    assert.ok(scripts[script!], `scripts/dev.ts invokes missing package script ${script}`);
  }
  assert.doesNotMatch(devSource, /max-old-space-size|NODE_OPTIONS/, "the collaboration launcher must not inflate every Node process heap");

  const runtimeSources = [
    devSource,
    read("scripts/run-e2e-with-prod-server.ts"),
    read("scripts/check-stability-env.ts"),
    read("scripts/check-api-versioning-contract.ts"),
    read("scripts/run-load-suite.ts"),
  ].join("\n");

  assert.doesNotMatch(runtimeSources, /presence:dev|services\/presence|presence-token|PRESENCE_WS|PRESENCE_TOKEN_SECRET|presence-room-fanout/);
  const presenceClient = read("src/lib/realtime/presence-client.ts");
  assert.match(presenceClient, /config:\s*\{\s*private:\s*true,\s*presence:\s*\{\s*key:/);
  assert.doesNotMatch(presenceClient, /\.joinRef\(/, "presence diagnostics must not call Supabase private channel methods");
  assert.doesNotMatch(read("src/app/api/v1/presence/heartbeat/route.ts"), /presence:live-session:/);
});

test("startup runtime avoids redundant remote work", () => {
  const appearanceRoute = read("src/app/api/v1/appearance/route.ts");
  const chatProvider = read("src/components/chat/ChatProvider.tsx");
  const instrumentation = read("src/instrumentation.ts");

  assert.doesNotMatch(appearanceRoute, /__getUserFromAuthServer|freshUser/);
  assert.match(appearanceRoute, /readAppearanceSnapshotFromMetadata\(auth\.user\)/);
  assert.match(chatProvider, /INITIAL_HEARTBEAT_COOLDOWN_MS/);
  assert.match(chatProvider, /heartbeat\(true\)/);
  assert.match(instrumentation, /OTEL_EXPORTER_OTLP_ENDPOINT\?\.trim\(\)/);
  assert.doesNotMatch(instrumentation, /http:\/\/localhost:4317/);
});
