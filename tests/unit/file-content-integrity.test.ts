import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("file reads never fabricate or persist empty recovery content", () => {
  const content = source("src/app/actions/files/content.ts");
  const viewer = source("src/components/projects/v2/files-tab/file/TextViewer.tsx");

  assert.match(content, /class FileContentUnavailableError/);
  assert.match(content, /code = "FILE_CONTENT_UNAVAILABLE"/);
  assert.doesNotMatch(content, /return "";\s*\n\s*}/);
  assert.doesNotMatch(content, /VIRTUAL FS HYDRATION ON READ/);
  assert.doesNotMatch(content, /Healing S3 upload|Successfully healed missing storage file/);
  assert.match(viewer, /if \(status === "error"\)/);
  assert.match(viewer, /Cannot save: file has no storage key/);
});

test("signed URL actions remain read-only", () => {
  const content = source("src/app/actions/files/content.ts");
  const signedUrlStart = content.indexOf("export async function getProjectFileSignedUrl");
  const formatStart = content.indexOf("export async function formatProjectFileContent");
  const signedUrlOwners = content.slice(signedUrlStart, formatStart);

  assert.ok(signedUrlStart > 0 && formatStart > signedUrlStart);
  assert.doesNotMatch(signedUrlOwners, /\.upload\(|db\.update\(/);
  assert.match(signedUrlOwners, /throw new FileContentUnavailableError\(\)/);
});
