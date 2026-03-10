import assert from "node:assert/strict";
import test from "node:test";

import {
  isReducedMotionEnabled,
  prefersReducedMotionFromAttributes,
  prefersReducedMotionFromSystem,
} from "../../src/lib/theme/reduced-motion";

test("prefersReducedMotionFromSystem handles missing matcher", () => {
  assert.equal(prefersReducedMotionFromSystem(undefined), false);
  assert.equal(prefersReducedMotionFromSystem(null), false);
});

test("prefersReducedMotionFromSystem returns matchMedia result", () => {
  const darkMatcher = ((query: string) => ({ matches: query.includes("reduce") })) as unknown as typeof window.matchMedia;
  assert.equal(prefersReducedMotionFromSystem(darkMatcher), true);
});

test("prefersReducedMotionFromAttributes reads data attribute", () => {
  const root = {
    getAttribute(name: string) {
      return name === "data-reduce-motion" ? "true" : null;
    },
  } as unknown as Element;

  assert.equal(prefersReducedMotionFromAttributes(root), true);
  assert.equal(prefersReducedMotionFromAttributes(null), false);
});

test("isReducedMotionEnabled uses attribute first then system fallback", () => {
  const attrRoot = {
    getAttribute(name: string) {
      return name === "data-reduce-motion" ? "true" : null;
    },
  } as unknown as Element;
  const systemMatcher = (() => ({ matches: false })) as unknown as typeof window.matchMedia;

  assert.equal(isReducedMotionEnabled({ root: attrRoot, matchMedia: systemMatcher }), true);

  const noAttrRoot = {
    getAttribute() {
      return null;
    },
  } as unknown as Element;
  const reduceMatcher = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  assert.equal(isReducedMotionEnabled({ root: noAttrRoot, matchMedia: reduceMatcher }), true);
});
