import assert from "node:assert/strict";
import test from "node:test";

import {
  getTaskFileWarnings,
  inferTaskFileRole,
  normalizeTaskTitleDraft,
  resolveTaskFileIntent,
} from "@/lib/projects/task-file-intelligence";

test("normalizeTaskTitleDraft collapses multiline whitespace into one logical title", () => {
  assert.equal(
    normalizeTaskTitleDraft("  Finish   the bugs\nfrom   the file  "),
    "Finish the bugs from the file",
  );
});

test("resolveTaskFileIntent recommends replacing an exact linked root match", () => {
  const resolution = resolveTaskFileIntent({
    candidateName: "report-final.pdf",
    attachments: [
      {
        id: "node-1",
        name: "report-final.pdf",
        type: "file",
        path: "/report-final.pdf",
        annotation: null,
      },
    ],
  });

  assert.equal(resolution.intent, "replace_existing");
  assert.equal(resolution.requiresPrompt, true);
  assert.equal(resolution.recommendedChoice, "replace");
  assert.equal(resolution.matchedNodeId, "node-1");
});

test("resolveTaskFileIntent detects files that already live under a linked folder", () => {
  const resolution = resolveTaskFileIntent({
    candidateName: "bug-fix.patch",
    attachments: [
      {
        id: "folder-1",
        name: "deliverables",
        type: "folder",
        path: "/deliverables",
        annotation: null,
      },
    ],
    searchMatches: [
      {
        id: "file-9",
        parentId: "folder-1",
        type: "file",
        name: "bug-fix.patch",
        path: "/deliverables/bug-fix.patch",
      },
    ],
  });

  assert.equal(resolution.intent, "candidate_child_of_linked_folder");
  assert.equal(resolution.requiresPrompt, true);
  assert.equal(resolution.recommendedChoice, "link_existing");
  assert.equal(resolution.linkedFolderId, "folder-1");
  assert.equal(resolution.matchedNodeId, "file-9");
});

test("inferTaskFileRole keeps deliverables, reference files, and working files distinct", () => {
  assert.equal(
    inferTaskFileRole({ name: "product-spec.docx", path: "/docs/product-spec.docx", type: "file", annotation: null }),
    "reference",
  );
  assert.equal(
    inferTaskFileRole({ name: "bug-fix.patch", path: "/deliverables/bug-fix.patch", type: "file", annotation: null }),
    "deliverable",
  );
  assert.equal(
    inferTaskFileRole({ name: "working-draft.md", path: "/working-draft.md", type: "file", annotation: null }),
    "working",
  );
});

// Wave 3 — folder intents

test("resolveTaskFileIntent emits folder_replace_existing when the dropped folder name matches a linked folder", () => {
  const resolution = resolveTaskFileIntent({
    candidateName: "deliverables",
    candidateType: "folder",
    candidateChildNames: ["a.png", "b.png"],
    attachments: [
      {
        id: "folder-1",
        name: "deliverables",
        type: "folder",
        path: "/deliverables",
        annotation: null,
      },
    ],
  });

  assert.equal(resolution.intent, "folder_replace_existing");
  assert.equal(resolution.requiresPrompt, true);
  assert.equal(resolution.recommendedChoice, "replace");
  assert.equal(resolution.linkedFolderId, "folder-1");
});

test("resolveTaskFileIntent emits folder_merge_into_existing when children overlap with linked files", () => {
  const resolution = resolveTaskFileIntent({
    candidateName: "assets",
    candidateType: "folder",
    candidateChildNames: ["logo.png", "fresh.png"],
    attachments: [
      {
        id: "folder-42",
        name: "exports",
        type: "folder",
        path: "/exports",
        annotation: null,
      },
      {
        id: "file-99",
        name: "logo.png",
        type: "file",
        path: "/exports/logo.png",
        annotation: null,
      },
    ],
  });

  assert.equal(resolution.intent, "folder_merge_into_existing");
  assert.equal(resolution.recommendedChoice, "merge");
  assert.equal(resolution.linkedFolderId, "folder-42");
});

test("resolveTaskFileIntent falls back to folder_create_subfolder when a linked folder exists but nothing overlaps", () => {
  const resolution = resolveTaskFileIntent({
    candidateName: "renders",
    candidateType: "folder",
    candidateChildNames: ["r1.png", "r2.png"],
    attachments: [
      {
        id: "folder-7",
        name: "deliverables",
        type: "folder",
        path: "/deliverables",
        annotation: null,
      },
    ],
  });

  assert.equal(resolution.intent, "folder_create_subfolder");
  assert.equal(resolution.recommendedChoice, "subfolder");
  assert.equal(resolution.linkedFolderId, "folder-7");
});

test("resolveTaskFileIntent on a folder with no overlap and no linked folders returns plain attach_new", () => {
  const resolution = resolveTaskFileIntent({
    candidateName: "fresh-folder",
    candidateType: "folder",
    candidateChildNames: ["one.txt"],
    attachments: [
      {
        id: "file-1",
        name: "something-else.pdf",
        type: "file",
        path: "/something-else.pdf",
        annotation: null,
      },
    ],
  });

  assert.equal(resolution.intent, "attach_new");
  assert.equal(resolution.requiresPrompt, false);
});

test("getTaskFileWarnings produces soft warnings for incomplete done-state files", () => {
  const warnings = getTaskFileWarnings({
    status: "done",
    attachments: [
      {
        id: "node-1",
        name: "project-spec.docx",
        type: "file",
        path: "/project-spec.docx",
        annotation: null,
      },
    ],
    unresolvedReplacement: true,
    unclassifiedUpload: true,
  });

  assert.deepEqual(
    warnings.map((warning) => warning.code),
    [
      "warning_only_reference_files",
      "warning_unresolved_replacement",
      "warning_unclassified_upload",
    ],
  );
});

// Regression — a `.py` file stored under a path that contains the
// substring "doc" (e.g. `~/Documents/hello.py`) used to be silently
// classified as "reference" because the keyword check was `String.includes`.
// It should now resolve to "working" (neutral) since the filename has no
// real signal in either direction.
test("inferTaskFileRole does not treat parent folder name substrings as keywords", () => {
  assert.equal(
    inferTaskFileRole({
      name: "hello.py",
      type: "file",
      path: "/Users/alice/Documents/hello.py",
      annotation: null,
    }),
    "working",
  );

  // Documented classifier with a word boundary: "docstring" should not
  // match the "doc" keyword on its own.
  assert.equal(
    inferTaskFileRole({
      name: "docstring-helpers.ts",
      type: "file",
      path: "/docstring-helpers.ts",
      annotation: null,
    }),
    "working",
  );

  // The annotation remains a first-class signal — if the user explicitly
  // tagged it, we trust them.
  assert.equal(
    inferTaskFileRole({
      name: "hello.py",
      type: "file",
      path: "/hello.py",
      annotation: "Final deliverable for the sprint",
    }),
    "deliverable",
  );
});

// Regression — the "only reference files" banner was firing on every task
// regardless of status. It should only appear when the user is about to
// close the loop (status === "done"). `getTaskFileWarnings` strips the
// synthetic `"ready"` entry, so an empty array is the all-clear signal.
test("getTaskFileWarnings stays quiet for non-done tasks with only reference files", () => {
  const warnings = getTaskFileWarnings({
    status: "todo",
    attachments: [
      {
        id: "node-1",
        name: "project-spec.docx",
        type: "file",
        path: "/project-spec.docx",
        annotation: null,
      },
    ],
  });

  assert.deepEqual(warnings, []);
});

test("getTaskFileWarnings still fires status-agnostic warnings outside of done", () => {
  const warnings = getTaskFileWarnings({
    status: "in_progress",
    attachments: [
      {
        id: "node-1",
        name: "project-spec.docx",
        type: "file",
        path: "/project-spec.docx",
        annotation: null,
      },
    ],
    unresolvedReplacement: true,
  });

  assert.deepEqual(
    warnings.map((warning) => warning.code),
    ["warning_unresolved_replacement"],
  );
});
