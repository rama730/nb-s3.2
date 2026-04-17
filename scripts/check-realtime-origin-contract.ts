import fs from "node:fs";
import path from "node:path";

function assertIncludes(source: string, pattern: RegExp, message: string, errors: string[]) {
  if (!pattern.test(source)) {
    errors.push(message);
  }
}

function main() {
  const root = process.cwd();
  const presenceServerPath = path.join(root, "services/presence/src/server.ts");
  const heartbeatRoutePath = path.join(root, "src/app/api/v1/presence/heartbeat/route.ts");

  const presenceServerSource = fs.readFileSync(presenceServerPath, "utf8");
  const heartbeatRouteSource = fs.readFileSync(heartbeatRoutePath, "utf8");

  const errors: string[] = [];

  assertIncludes(presenceServerSource, /isAllowedUpgradeOrigin/, "presence server must validate websocket upgrade origins", errors);
  assertIncludes(presenceServerSource, /verifyPresenceEventEnvelope/, "presence server must verify signed pubsub events", errors);
  assertIncludes(presenceServerSource, /presence:live-session:/, "presence server must maintain live-session state", errors);
  assertIncludes(heartbeatRouteSource, /presence:live-session:/, "heartbeat route must require a live presence session", errors);
  assertIncludes(heartbeatRouteSource, /getViewerAuthContext/, "heartbeat route must resolve the authenticated viewer context", errors);

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
