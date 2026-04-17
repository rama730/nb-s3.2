import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { signPresenceEventEnvelope, verifyPresenceEventEnvelope } from "@/lib/realtime/presence-event-signing";

describe("presence event signing", () => {
  it("verifies signed envelopes", () => {
    const envelope = signPresenceEventEnvelope({
      type: "presence.delta",
      action: "upsert",
      roomType: "conversation",
      roomId: "room-1",
      member: { userId: "user-1" },
    });

    assert.equal(verifyPresenceEventEnvelope(envelope), true);
  });

  it("rejects tampered envelopes", () => {
    const envelope = signPresenceEventEnvelope({
      type: "presence.delta",
      action: "upsert",
      roomType: "conversation",
      roomId: "room-1",
      member: { userId: "user-1" },
    });

    assert.equal(
      verifyPresenceEventEnvelope({
        ...envelope,
        payload: {
          ...envelope.payload,
          member: { userId: "user-2" },
        },
      }),
      false,
    );
  });
});
