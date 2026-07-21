import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_GLOBAL_SEARCH_LENGTH,
  containsLikePattern,
  escapeLikePattern,
  normalizeSearchQuery,
  tokenizeSearchQuery,
} from "@/lib/search/query";
import {
  SearchPreviewError,
  isRetryableSearchError,
  toSearchPreviewError,
} from "@/lib/search/contracts";

test("global search normalization is Unicode-safe, bounded, and strips controls", () => {
  assert.equal(normalizeSearchQuery("  React\u0000\n  Native  "), "React Native");
  assert.equal(normalizeSearchQuery("ＡＩ"), "AI");
  assert.equal(normalizeSearchQuery(undefined), "");
  assert.equal(normalizeSearchQuery("x".repeat(140)).length, MAX_GLOBAL_SEARCH_LENGTH);
});

test("global search tokenization is bounded and wildcard matching is literal", () => {
  assert.deepEqual(tokenizeSearchQuery("one two three", 2), ["one", "two"]);
  assert.equal(escapeLikePattern("100%_done\\ok"), "100\\%\\_done\\\\ok");
  assert.equal(containsLikePattern("50%"), "%50\\%%");
});

test("global search retries only typed transient failures", () => {
  assert.equal(toSearchPreviewError("Too many searches").code, "RATE_LIMITED");
  assert.equal(isRetryableSearchError(new SearchPreviewError("temporary", "TRANSIENT")), true);
  assert.equal(isRetryableSearchError(new SearchPreviewError("forbidden", "FORBIDDEN")), false);
  assert.equal(isRetryableSearchError(new Error("temporary")), false);
});
