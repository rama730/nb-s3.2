import fs from "node:fs";
import path from "node:path";

function assertIncludes(source: string, pattern: RegExp, message: string, errors: string[]) {
  if (!pattern.test(source)) {
    errors.push(message);
  }
}

function assertExcludes(source: string, pattern: RegExp, message: string, errors: string[]) {
  if (pattern.test(source)) {
    errors.push(message);
  }
}

function main() {
  const root = process.cwd();
  const presenceClientPath = path.join(root, "src/lib/realtime/presence-client.ts");
  const heartbeatRoutePath = path.join(root, "src/app/api/v1/presence/heartbeat/route.ts");

  const presenceClientSource = fs.readFileSync(presenceClientPath, "utf8");
  const heartbeatRouteSource = fs.readFileSync(heartbeatRoutePath, "utf8");

  const errors: string[] = [];

  assertIncludes(presenceClientSource, /createClient\(\)/, "presence must use the shared Supabase browser client", errors);
  assertIncludes(presenceClientSource, /config:\s*\{\s*presence:\s*\{\s*key:/, "presence channels must configure a stable connection key", errors);
  assertIncludes(presenceClientSource, /\.on\("presence",\s*\{\s*event:\s*"sync"\s*\}/, "presence client must reconcile channel state", errors);
  assertIncludes(presenceClientSource, /\.removeChannel\(/, "presence client must release Supabase channels", errors);
  assertExcludes(presenceClientSource, /presence-token|PRESENCE_WS|new WebSocket/, "presence client must not depend on the removed custom websocket service", errors);
  assertIncludes(heartbeatRouteSource, /getViewerAuthContext/, "heartbeat route must resolve the authenticated viewer context", errors);
  assertIncludes(heartbeatRouteSource, /validateCsrf/, "heartbeat route must retain CSRF validation", errors);
  assertExcludes(heartbeatRouteSource, /presence:live-session:/, "heartbeat route must not depend on state from the removed presence service", errors);

  if (errors.length > 0) {
    console.error("[realtime-origin-contract] failed:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log("[realtime-origin-contract] ok");
}

main();
