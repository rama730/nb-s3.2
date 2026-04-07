import test from "node:test";
import assert from "node:assert/strict";

import {
  getTypingDisplayName,
  getTypingStatusText,
  type TypingDisplayUser,
} from "@/lib/chat/typing-display";

test("getTypingDisplayName prefers full name, then username, then Someone", () => {
  assert.equal(
    getTypingDisplayName({ id: "1", fullName: "Rama", username: "rama" }),
    "Rama",
  );
  assert.equal(
    getTypingDisplayName({ id: "1", fullName: null, username: "rama" }),
    "rama",
  );
  assert.equal(
    getTypingDisplayName({ id: "1", fullName: null, username: null }),
    "Someone",
  );
});

test("getTypingStatusText formats single, pair, and group typing states consistently", () => {
  const one: TypingDisplayUser[] = [{ id: "1", fullName: "Rama", username: "rama" }];
  const two: TypingDisplayUser[] = [
    { id: "1", fullName: "Rama", username: "rama" },
    { id: "2", fullName: "Edge User", username: "edge" },
  ];
  const three: TypingDisplayUser[] = [
    { id: "1", fullName: "Rama", username: "rama" },
    { id: "2", fullName: "Edge User", username: "edge" },
    { id: "3", fullName: "Peer", username: "peer" },
  ];

  assert.equal(getTypingStatusText([]), null);
  assert.equal(getTypingStatusText(one), "Rama is typing");
  assert.equal(getTypingStatusText(one, { ellipsis: true }), "Rama is typing...");
  assert.equal(getTypingStatusText(two), "Rama and Edge User are typing");
  assert.equal(getTypingStatusText(three), "Rama and 2 others are typing");
});
