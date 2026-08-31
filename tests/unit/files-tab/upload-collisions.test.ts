import assert from "node:assert/strict";
import test from "node:test";

import { getUploadCollisionMessage, selectUploadFiles } from "@/lib/files/upload-collisions";

test("retries preserve committed files and deduplicate filenames without mutating input", () => {
  const files = [{ name: "saved.pdf" }, { name: "Sketch.png" }, { name: "sketch.PNG" }, { name: "new.txt" }];
  assert.deepEqual(selectUploadFiles(files, ["SAVED.pdf"]), [files[1], files[3]]);
  assert.equal(files.length, 4);
  assert.deepEqual(selectUploadFiles([], []), []);
});

test("does not prompt when an upload has no collisions", () => {
  assert.equal(
    getUploadCollisionMessage({
      existingFiles: [],
      existingFolders: [],
      folderIdsByPath: {},
    }),
    null,
  );
});

test("explains the safe collision policy before an upload continues", () => {
  assert.equal(
    getUploadCollisionMessage({
      existingFiles: ["brief.pdf", "nested/readme.md"],
      existingFolders: ["nested"],
      folderIdsByPath: { nested: "folder-1" },
    }),
    "Some uploaded items already exist. 1 existing folder will be reused and 2 existing files will be skipped. Continue?",
  );
});
