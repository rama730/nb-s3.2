import assert from "node:assert/strict";
import test from "node:test";
import Module, { createRequire } from "node:module";
import { contentHashes } from "../../src/lib/github/sync-contract";

// Next aliases this marker to its empty server module; use the same boundary in this server test.
const loader = Module as unknown as {
  _load: (request: string, ...args: unknown[]) => unknown;
};
const originalLoad = loader._load;
loader._load = (request, ...args) =>
  request === "server-only" ? {} : originalLoad(request, ...args);
const { requireExistingOrEmptyBranch, readGitHubBlob } = createRequire(
  import.meta.url,
)(
  "../../src/lib/github/sync-api",
) as typeof import("../../src/lib/github/sync-api");
loader._load = originalLoad;
test("a missing branch cannot silently initialize an unrelated history", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("/branches?")
            ? [{ name: "main" }]
            : { message: "Not Found" },
        ),
        { status: String(url).includes("/branches?") ? 200 : 404 },
      );
    await assert.rejects(
      requireExistingOrEmptyBranch(
        "test",
        "https://github.com/example/repo",
        "typo",
      ),
      /branch does not exist/,
    );
    globalThis.fetch = async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("/branches?") ? [] : { message: "Not Found" },
        ),
        { status: String(url).includes("/branches?") ? 200 : 404 },
      );
    assert.equal(
      await requireExistingOrEmptyBranch(
        "test",
        "https://github.com/example/repo",
        "main",
      ),
      null,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("downloaded GitHub content must match the reviewed blob identity", async () => {
  const original = globalThis.fetch;
  const bytes = Buffer.from("reviewed content\n");
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          encoding: "base64",
          size: bytes.length,
          content: bytes.toString("base64"),
        }),
      );
    assert.deepEqual(
      await readGitHubBlob(
        "test",
        "https://github.com/example/repo",
        contentHashes(bytes).blobSha,
      ),
      bytes,
    );
    await assert.rejects(
      readGitHubBlob("test", "https://github.com/example/repo", "0".repeat(40)),
      /integrity/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
