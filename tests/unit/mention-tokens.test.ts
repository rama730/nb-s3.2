// ============================================================================
// Task Panel Overhaul - Wave 4
//
// Unit coverage for the @mention token format. These tests pin the grammar
// (@{uuid}|DisplayName) because the server action, the composer, and the
// renderer all rely on identical parsing. If any of them drift, comments that
// round-trip through the DB will silently corrupt their chips.
// ============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MENTION_DISPLAY_NAME_MAX_LENGTH,
  buildMentionToken,
  extractMentionIds,
  isValidUserId,
  parseMentions,
  sanitizeMentionDisplayName,
  serializeSegments,
  type MentionSegment,
} from "@/lib/projects/mention-tokens";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

describe("mention-tokens: parseMentions", () => {
  it("returns empty result for empty input", () => {
    const out = parseMentions("");
    assert.deepEqual(out, { plainText: "", mentionIds: [], segments: [] });
  });

  it("treats a plain string with no tokens as a single text segment", () => {
    const out = parseMentions("hello world");
    assert.equal(out.plainText, "hello world");
    assert.deepEqual(out.mentionIds, []);
    assert.deepEqual(out.segments, [{ type: "text", value: "hello world" }]);
  });

  it("extracts a single mention in the middle of text", () => {
    const raw = `hey @{${USER_A}|Alice} take a look`;
    const out = parseMentions(raw);
    assert.equal(out.plainText, "hey @Alice take a look");
    assert.deepEqual(out.mentionIds, [USER_A]);
    assert.equal(out.segments.length, 3);
    assert.deepEqual(out.segments[0], { type: "text", value: "hey " });
    assert.deepEqual(out.segments[1], {
      type: "mention",
      userId: USER_A,
      displayName: "Alice",
    });
    assert.deepEqual(out.segments[2], { type: "text", value: " take a look" });
  });

  it("handles a mention at the start of the content", () => {
    const raw = `@{${USER_A}|Alice} welcome!`;
    const out = parseMentions(raw);
    assert.equal(out.plainText, "@Alice welcome!");
    assert.equal(out.segments[0].type, "mention");
  });

  it("handles a mention at the end of the content with no trailing text", () => {
    const raw = `ping @{${USER_A}|Alice}`;
    const out = parseMentions(raw);
    assert.equal(out.plainText, "ping @Alice");
    assert.equal(out.segments.length, 2);
    assert.equal(out.segments[1].type, "mention");
  });

  it("preserves multi-word display names thanks to the closing brace terminator", () => {
    const raw = `hi @{${USER_A}|Alice Smith} see below`;
    const out = parseMentions(raw);
    assert.equal(out.plainText, "hi @Alice Smith see below");
    assert.deepEqual(out.mentionIds, [USER_A]);
    assert.equal(out.segments.length, 3);
    assert.deepEqual(out.segments[1], {
      type: "mention",
      userId: USER_A,
      displayName: "Alice Smith",
    });
  });

  it("returns distinct mention ids in order of first appearance", () => {
    const raw = `@{${USER_B}|Bob} + @{${USER_A}|Alice} + @{${USER_B}|Bob again}`;
    const out = parseMentions(raw);
    // USER_B first, then USER_A, and B is not duplicated despite two tokens.
    assert.deepEqual(out.mentionIds, [USER_B, USER_A]);
  });

  it("normalizes mentioned user ids to lowercase even when stored uppercase", () => {
    const upper = USER_A.toUpperCase();
    const raw = `@{${upper}|Alice}`;
    const out = parseMentions(raw);
    assert.deepEqual(out.mentionIds, [USER_A.toLowerCase()]);
    assert.equal(
      (out.segments[0] as Extract<MentionSegment, { type: "mention" }>).userId,
      USER_A.toLowerCase(),
    );
  });

  it("passes malformed tokens through as plain text instead of throwing", () => {
    // Missing display name, invalid uuid, stray braces - none of these are
    // real tokens and they must render as prose.
    const raw = "email looks like @{not-a-uuid}|Alice and @{plain text}";
    const out = parseMentions(raw);
    assert.equal(out.plainText, raw);
    assert.deepEqual(out.mentionIds, []);
    assert.equal(out.segments.length, 1);
    assert.equal(out.segments[0].type, "text");
  });

  it("caps the display name at MENTION_DISPLAY_NAME_MAX_LENGTH characters", () => {
    const longName = "A".repeat(MENTION_DISPLAY_NAME_MAX_LENGTH + 50);
    // Over-length tokens must not match - they fail the {1,120} bound - so
    // they fall through as text.
    const raw = `@{${USER_A}|${longName}}`;
    const out = parseMentions(raw);
    assert.deepEqual(out.mentionIds, []);
    assert.equal(out.plainText, raw);
  });
});

describe("mention-tokens: extractMentionIds", () => {
  it("is a thin wrapper returning only the mention ids", () => {
    const raw = `hello @{${USER_A}|Alice} + @{${USER_B}|Bob}`;
    assert.deepEqual(extractMentionIds(raw), [USER_A, USER_B]);
  });

  it("returns [] for content with no tokens", () => {
    assert.deepEqual(extractMentionIds("nothing here"), []);
  });
});

describe("mention-tokens: buildMentionToken", () => {
  it("emits a parse-roundtrippable token", () => {
    const token = buildMentionToken({ userId: USER_A, displayName: "Alice" });
    assert.equal(token, `@{${USER_A}|Alice}`);
    const parsed = parseMentions(token);
    assert.deepEqual(parsed.mentionIds, [USER_A]);
  });

  it("throws on invalid userId", () => {
    assert.throws(() =>
      buildMentionToken({ userId: "not-a-uuid", displayName: "Alice" }),
    );
  });

  it("sanitizes the display name", () => {
    const token = buildMentionToken({
      userId: USER_A,
      displayName: "  Alice | @Bob  {weird}  ",
    });
    // Delimiters stripped, whitespace collapsed.
    assert.equal(token, `@{${USER_A}|Alice Bob weird}`);
  });

  it("falls back to a safe placeholder when the name sanitizes to empty", () => {
    const token = buildMentionToken({ userId: USER_A, displayName: "@@@|||" });
    assert.equal(token, `@{${USER_A}|user}`);
  });

  it("lowercases an uppercase userId", () => {
    const token = buildMentionToken({
      userId: USER_A.toUpperCase(),
      displayName: "Alice",
    });
    assert.equal(token, `@{${USER_A.toLowerCase()}|Alice}`);
  });
});

describe("mention-tokens: sanitizeMentionDisplayName", () => {
  it("collapses newlines and tabs into spaces", () => {
    assert.equal(sanitizeMentionDisplayName("foo\nbar\tbaz"), "foo bar baz");
  });

  it("strips delimiter characters", () => {
    assert.equal(sanitizeMentionDisplayName("a{b}c|d@e"), "abcde");
  });

  it("collapses runs of spaces and trims", () => {
    assert.equal(sanitizeMentionDisplayName("  a    b   "), "a b");
  });

  it("truncates to the configured max length", () => {
    const input = "B".repeat(MENTION_DISPLAY_NAME_MAX_LENGTH + 10);
    const out = sanitizeMentionDisplayName(input);
    assert.equal(out.length, MENTION_DISPLAY_NAME_MAX_LENGTH);
  });

  it("handles null-like inputs without throwing", () => {
    assert.equal(
      sanitizeMentionDisplayName(undefined as unknown as string),
      "",
    );
    assert.equal(sanitizeMentionDisplayName(""), "");
  });
});

describe("mention-tokens: serializeSegments", () => {
  it("round-trips segments produced by parseMentions", () => {
    const raw = `hey @{${USER_A}}|Alice and @{${USER_B}}|Bob, welcome`;
    const parsed = parseMentions(raw);
    const serialized = serializeSegments(parsed.segments);
    // Round-trip yields the same stored form.
    assert.equal(serialized, raw);
  });

  it("serializes a mention-only segment list", () => {
    const segments: MentionSegment[] = [
      { type: "mention", userId: USER_A, displayName: "Alice" },
    ];
    assert.equal(serializeSegments(segments), `@{${USER_A}|Alice}`);
  });

  it("serializes adjacent text segments by concatenation", () => {
    const segments: MentionSegment[] = [
      { type: "text", value: "hello " },
      { type: "text", value: "world" },
    ];
    assert.equal(serializeSegments(segments), "hello world");
  });

  it("sanitizes display names on write so emitted tokens parse", () => {
    const segments: MentionSegment[] = [
      { type: "mention", userId: USER_A, displayName: "Alice|Evil" },
    ];
    const out = serializeSegments(segments);
    const reparsed = parseMentions(out);
    assert.deepEqual(reparsed.mentionIds, [USER_A]);
  });
});

describe("mention-tokens: isValidUserId", () => {
  it("accepts canonical uuids", () => {
    assert.equal(isValidUserId(USER_A), true);
    assert.equal(isValidUserId(USER_A.toUpperCase()), true);
  });

  it("rejects non-uuid strings", () => {
    assert.equal(isValidUserId(""), false);
    assert.equal(isValidUserId("not-a-uuid"), false);
    assert.equal(isValidUserId("11111111-1111-1111-1111-11111111111"), false);
  });
});
