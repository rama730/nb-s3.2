import test from "node:test";
import assert from "node:assert/strict";
import { isNoOpSave, resolvePostSaveState } from "@/lib/files/save-logic";

test("unchanged-content save is treated as no-op", () => {
  assert.equal(isNoOpSave("hello world", "hello world"), true);
  assert.equal(isNoOpSave("hello world", "hello world!"), false);
});

test("in-flight save followed by edit keeps tab dirty", () => {
  const postSave = resolvePostSaveState({
    savedContent: "before-save",
    currentContent: "before-save plus new edit",
  });

  assert.equal(postSave.isDirty, true);
  assert.equal(postSave.savedSnapshot, "before-save");
});

test("post-save state is clean when content did not change during save", () => {
  const postSave = resolvePostSaveState({
    savedContent: "stable-content",
    currentContent: "stable-content",
  });

  assert.equal(postSave.isDirty, false);
  assert.equal(postSave.savedSnapshot, "stable-content");
});
