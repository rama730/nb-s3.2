// Property 6 — IDB Session Key Round-Trip
//
// **Validates: Requirements 13.4**
//
// Task-Files Version Control V3 spec, Task 13.6. See design.md § Correctness
// Properties / Property 6 for the prose statement, and
// `src/lib/files/open-file-sessions.ts` for the subject under test.
//
// Invariant (design.md § Property 6):
//   For all valid `(nodeId, filename)` pairs, writing a session under the new
//   key format and reading it back via `findSessionByNodeId` returns equivalent
//   session data. Formally:
//     `write(nodeId, session) |> findSessionByNodeId(nodeId) == session`
//
// Additionally, the legacy key format `${nodeId}::${filename}` is a valid
// fallback: if only a legacy-keyed session exists, `findSessionByNodeId` still
// resolves it.
//
// Since IDB is not available in the Node.js test environment, we build an
// in-memory mock that mirrors the production store's lookup semantics:
//   1. Direct lookup by new key (`sessionKey(nodeId)`) — primary path.
//   2. Fallback scan for legacy keys matching `nodeId` field — migration path.
// This mirrors the implementation in `findSessionByNodeId`.

import test from "node:test";
import fc from "fast-check";
import assert from "node:assert/strict";

import {
  sessionKey,
  legacySessionKey,
  type OpenFileSession,
  type IdeKind,
} from "@/lib/files/open-file-sessions";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Valid characters for nodeId: alphanumeric, hyphens, underscores, dots.
// Mimics UUID-style or slug-style identifiers used in the app.
const nodeIdCharArb = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyz0123456789-_".split(""),
);

const nodeIdArb = fc
  .string({ unit: nodeIdCharArb, minLength: 1, maxLength: 40 })
  // Ensure nodeId doesn't contain "::" which would confuse legacy key parsing
  .filter((id) => !id.includes("::"));

// Valid filename characters: printable ASCII minus path separators and control chars.
const filenameCharArb = fc
  .integer({ min: 0x20, max: 0x7e })
  .map((cp) => String.fromCodePoint(cp))
  .filter((ch) => ch !== "/" && ch !== "\\" && ch !== "\0");

const filenameArb = fc.string({ unit: filenameCharArb, minLength: 1, maxLength: 30 });

const ideKindArb = fc.constantFrom<IdeKind>("cursor", "vscode", "workspace");

// Hex character generator for SHA-256 hashes.
const hexCharArb = fc.constantFrom(..."0123456789abcdef".split(""));
const hexHashArb = fc.string({ unit: hexCharArb, minLength: 64, maxLength: 64 });

// Generate a full session payload (minus the `id` field which is derived from key format).
const sessionPayloadArb = fc.record({
  nodeId: nodeIdArb,
  taskId: nodeIdArb,
  projectId: nodeIdArb,
  filename: filenameArb,
  originalHash: fc.oneof(hexHashArb, fc.constant(null)),
  localPath: fc.string({ minLength: 1, maxLength: 60 }),
  ide: ideKindArb,
  openedAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
});

// ---------------------------------------------------------------------------
// In-memory IDB mock — mirrors findSessionByNodeId semantics
// ---------------------------------------------------------------------------

type SessionStore = Map<string, OpenFileSession>;

function mockWrite(store: SessionStore, session: OpenFileSession): void {
  store.set(session.id, session);
}

/**
 * Mirrors `findSessionByNodeId` from open-file-sessions.ts:
 *   1. Try new key format first: direct lookup by `sessionKey(nodeId)`.
 *   2. Fall back to scanning all entries for matching `nodeId` field.
 *      Return the most recent (highest `openedAt`) match.
 */
function mockFindSessionByNodeId(
  store: SessionStore,
  nodeId: string,
): OpenFileSession | null {
  // Primary path: direct lookup by new key format.
  const direct = store.get(sessionKey(nodeId));
  if (direct) return direct;

  // Fallback: scan for entries with matching nodeId (legacy keys).
  const matches: OpenFileSession[] = [];
  for (const session of store.values()) {
    if (session.nodeId === nodeId) {
      matches.push(session);
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.openedAt - a.openedAt);
  return matches[0];
}

// ---------------------------------------------------------------------------
// Property assertion — design.md § Property 6
// ---------------------------------------------------------------------------

test("Property 6: IDB Session Key Round-Trip — write(nodeId, session) |> findSessionByNodeId(nodeId) == session", () => {
  // **Validates: Requirements 13.4**
  fc.assert(
    fc.property(sessionPayloadArb, (payload) => {
      const store: SessionStore = new Map();

      // Write session using new key format (Req 13.3: new writes use only `${nodeId}`).
      const session: OpenFileSession = {
        ...payload,
        id: sessionKey(payload.nodeId),
      };
      mockWrite(store, session);

      // Read back via findSessionByNodeId (Req 13.1: tries new key first).
      const found = mockFindSessionByNodeId(store, payload.nodeId);

      // Invariant: the read-back session equals the written session.
      assert.ok(found, "findSessionByNodeId must find the written session");
      assert.equal(found.id, session.id, "session id must match");
      assert.equal(found.nodeId, session.nodeId, "nodeId must match");
      assert.equal(found.taskId, session.taskId, "taskId must match");
      assert.equal(found.projectId, session.projectId, "projectId must match");
      assert.equal(found.filename, session.filename, "filename must match");
      assert.equal(found.originalHash, session.originalHash, "originalHash must match");
      assert.equal(found.localPath, session.localPath, "localPath must match");
      assert.equal(found.ide, session.ide, "ide must match");
      assert.equal(found.openedAt, session.openedAt, "openedAt must match");

      return true;
    }),
    { numRuns: 100 },
  );
});

test("Property 6b: IDB Session Key Round-Trip — legacy fallback: legacyWrite |> findSessionByNodeId == session", () => {
  // **Validates: Requirements 13.4**
  // Verifies that the legacy key format `${nodeId}::${filename}` is a valid
  // fallback when no new-format key exists.
  fc.assert(
    fc.property(sessionPayloadArb, (payload) => {
      const store: SessionStore = new Map();

      // Write session using LEGACY key format (simulating pre-migration data).
      const legacySession: OpenFileSession = {
        ...payload,
        id: legacySessionKey(payload.nodeId, payload.filename),
      };
      mockWrite(store, legacySession);

      // Read back via findSessionByNodeId — should fall back to legacy scan (Req 13.2).
      const found = mockFindSessionByNodeId(store, payload.nodeId);

      // Invariant: the read-back session equals the written session.
      assert.ok(found, "findSessionByNodeId must find the legacy-keyed session via fallback");
      assert.equal(found.nodeId, legacySession.nodeId, "nodeId must match");
      assert.equal(found.taskId, legacySession.taskId, "taskId must match");
      assert.equal(found.projectId, legacySession.projectId, "projectId must match");
      assert.equal(found.filename, legacySession.filename, "filename must match");
      assert.equal(found.originalHash, legacySession.originalHash, "originalHash must match");
      assert.equal(found.localPath, legacySession.localPath, "localPath must match");
      assert.equal(found.ide, legacySession.ide, "ide must match");
      assert.equal(found.openedAt, legacySession.openedAt, "openedAt must match");

      return true;
    }),
    { numRuns: 100 },
  );
});

test("Property 6c: IDB Session Key Round-Trip — new key takes priority over legacy key", () => {
  // **Validates: Requirements 13.4**
  // When both a new-format and legacy-format session exist for the same nodeId,
  // findSessionByNodeId returns the new-format session (Req 13.1: tries new key first).
  fc.assert(
    fc.property(sessionPayloadArb, (payload) => {
      const store: SessionStore = new Map();

      // Write legacy session first.
      const legacySession: OpenFileSession = {
        ...payload,
        id: legacySessionKey(payload.nodeId, payload.filename),
        openedAt: payload.openedAt - 1000, // older
      };
      mockWrite(store, legacySession);

      // Write new-format session (more recent).
      const newSession: OpenFileSession = {
        ...payload,
        id: sessionKey(payload.nodeId),
      };
      mockWrite(store, newSession);

      // Read back — should return the new-format session (direct lookup wins).
      const found = mockFindSessionByNodeId(store, payload.nodeId);

      assert.ok(found, "findSessionByNodeId must find a session");
      assert.equal(
        found.id,
        sessionKey(payload.nodeId),
        "new key format must take priority over legacy key",
      );
      assert.equal(found.openedAt, payload.openedAt, "should return the new-format session");

      return true;
    }),
    { numRuns: 100 },
  );
});
