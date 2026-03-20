import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCursorThrottle,
  createPresenceManager,
  decodeCursorFrame,
  encodeCursorFrame,
  type CursorFrame,
} from "../../src/components/projects/v2/workspace/cursorProtocol";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("cursor protocol concurrency", () => {
  it("broadcasts only the latest pending frame inside the 4Hz throttle window", async () => {
    const payloads: Uint8Array[] = [];
    const throttle = createCursorThrottle((payload) => payloads.push(payload));

    const firstFrame: CursorFrame = {
      userId: "user-1",
      nodeId: "node-1",
      line: 1,
      column: 1,
      selectionStart: 1,
      selectionEnd: 1,
      timestamp: Date.now(),
    };
    const secondFrame: CursorFrame = {
      ...firstFrame,
      line: 42,
      column: 7,
      timestamp: Date.now() + 1,
    };

    throttle.send(firstFrame);
    throttle.send(secondFrame);
    await wait(300);

    assert.equal(payloads.length, 1);
    const decoded = decodeCursorFrame(payloads[0]);
    assert.equal(decoded.line, 42);
    assert.equal(decoded.column, 7);
    throttle.destroy();
  });

  it("drops stale incoming frames and preserves user display name mapping", () => {
    const manager = createPresenceManager();
    manager.registerUser("remote-user", "Remote User");
    manager.registerNode("node-remote");

    const staleFrame: CursorFrame = {
      userId: "remote-user",
      userName: "Remote User",
      nodeId: "node-remote",
      line: 5,
      column: 1,
      selectionStart: 1,
      selectionEnd: 1,
      timestamp: Date.now() - 2_000,
    };
    const staleResult = manager.processIncoming(encodeCursorFrame(staleFrame), 0);
    assert.equal(staleResult, null);

    const freshFrame: CursorFrame = {
      ...staleFrame,
      line: 8,
      timestamp: Date.now(),
    };
    const freshResult = manager.processIncoming(encodeCursorFrame(freshFrame), 0);
    assert.ok(freshResult);
    assert.equal(freshResult?.userId, "remote-user");
    assert.equal(freshResult?.userName, "Remote User");
    assert.equal(freshResult?.line, 8);

    manager.destroy();
    assert.equal(manager.cursors.size, 0);
  });
});
