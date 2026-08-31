import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("Supabase Auth and database clients keep one native owner", () => {
  const browserClient = source("src/lib/supabase/client.ts");
  const database = source("src/lib/db/index.ts");

  assert.doesNotMatch(browserClient, /\block\s*:/, "browser Auth must use Supabase's native navigator lock");
  assert.doesNotMatch(database, /6544/, "read traffic must never invent an undocumented pooler port");
  assert.match(database, /env\.READ_DATABASE_URL[\s\S]*\? resolvePoolerConnectionString\(env\.READ_DATABASE_URL\)[\s\S]*: resolvedConnectionString/);
});

test("application wrappers do not compete with native Realtime reconnect", () => {
  const provider = source("src/components/providers/RealtimeProvider.tsx");
  const taskResource = source("src/lib/realtime/task-resource.ts");
  const projectFiles = source("src/lib/realtime/project-files-channel.ts");

  for (const implementation of [provider, taskResource, projectFiles]) {
    assert.doesNotMatch(implementation, /scheduleReconnect|reconnectTimer|reconnectAttempt|MAX_BACKOFF_MS|BACKOFF_START_MS/);
  }
  assert.match(provider, /void supabase\.removeChannel\(channel\)/);
  assert.match(taskResource, /native Realtime owns reconnects/);
  assert.match(projectFiles, /Supabase Realtime owns socket reconnect and channel rejoin/);
});

test("Realtime health distinguishes authentication startup from terminal channel failure", () => {
  const provider = source("src/components/providers/RealtimeProvider.tsx");
  const notifications = source("src/hooks/useNotifications.ts");
  const messages = source("src/hooks/useMessagesV2Realtime.ts");
  const typing = source("src/hooks/usePresenceTyping.ts");
  const online = source("src/hooks/useOnlineUsers.ts");
  const publisher = source("src/hooks/usePublishOnlinePresence.ts");

  assert.match(provider, /'idle' \| 'connecting' \| 'connected' \| 'disconnected'/);
  assert.match(notifications, /notificationStatus !== 'disconnected'/);
  assert.match(messages, /messagingStatus === 'disconnected'/);
  for (const hook of [typing, online, publisher]) {
    assert.match(hook, /session\?\.access_token/);
    assert.match(hook, /realtimeReady/);
  }
});

test("hydration is Realtime-first with a bounded fallback", () => {
  const hydration = source("src/components/projects/HydrationProgressBanner.tsx");

  assert.match(hydration, /REALTIME_MISSED_PROGRESS_MS = 30_000/);
  assert.match(hydration, /FALLBACK_POLL_MS = 15_000/);
  assert.match(hydration, /status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT" \|\| status === "CLOSED"/);
  assert.doesNotMatch(hydration, /setTimeout\(fetchProgress, 5000\)/);
  assert.match(hydration, /if \(error\) \{[\s\S]*queuePoll\(FALLBACK_POLL_MS\)/);
});

test("logout deletes the authenticated push record before local and Auth teardown", () => {
  const push = source("src/lib/notifications/web-push-client.ts");
  const auth = source("src/components/providers/AuthProvider.tsx");
  const signOut = auth.slice(auth.indexOf("const signOut = useCallback"));

  assert.ok(push.indexOf("deletePushSubscriptionAction(endpoint)") < push.indexOf("sub.unsubscribe()"));
  assert.match(push, /return \{ ok: false, reason: "server_cleanup_failed" \}/);
  assert.ok(signOut.indexOf("await unsubscribeWebPush()") < signOut.indexOf("syncBrowserSessionToServer(null)"));
  assert.ok(signOut.indexOf("await unsubscribeWebPush()") < signOut.indexOf("supabase.auth.signOut()"));
});

test("presence is chat-scoped and debounce markers follow persistence", () => {
  const runtime = source("src/components/providers/MainRuntimeProviders.tsx");
  const chat = source("src/components/chat/ChatProvider.tsx");
  const heartbeat = source("src/app/api/v1/presence/heartbeat/route.ts");

  assert.match(runtime, /<LazyChatProvider presenceEnabled=\{isMessagesRoute \|\| popupOpen\}/);
  assert.match(chat, /useMessagesV2OutboxSync\(active\)/);
  assert.match(chat, /const presenceActive = active && presenceEnabled/);
  assert.match(chat, /document\.hidden \? pause\(\) : resume\(\)/);
  assert.match(chat, /CHAT_IDLE_MS/);
  assert.match(chat, /presenceActive && engaged \? <OnlinePresencePublisher/);
  assert.ok(heartbeat.indexOf("withDbRetry(\"presence.heartbeat.last_active\"") < heartbeat.indexOf("redis.set(debounceKey"));
  assert.ok(heartbeat.indexOf("withDbRetry(\"presence.heartbeat.last_active\"") < heartbeat.indexOf("markLocallyDebounced(debounceKey)"));
});

test("extension workspace bounds root files per project", () => {
  const workspace = source("src/app/api/v1/extension/workspace/route.ts");

  assert.match(workspace, /row_number\(\) OVER \(\s*PARTITION BY \$\{projectNodes\.projectId\}/);
  assert.match(workspace, /WHERE ranked\.rn <= 100/);
  assert.doesNotMatch(workspace, /\.limit\(Math\.max\(100, projectIds\.length \* 100\)\)/);
});
