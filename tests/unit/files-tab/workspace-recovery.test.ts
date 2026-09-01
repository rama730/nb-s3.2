import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { filesReturnQuery, taskFilesHref } from "@/lib/files/task-navigation";
import { confirmFileNavigation } from "@/lib/files/unsaved-navigation";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import {
  formatBytes,
  formatFileActor,
  formatFileTimestamp,
} from "@/components/projects/v2/files-tab/folder/format";
import { FileIcon } from "@/components/projects/v2/explorer/FileIcons";

test("task drawer returns to the same Files scope, query, file and inspector", () => {
  const origin = new URLSearchParams({
    tab: "files",
    filesView: "tasks",
    filesTask: "task-1",
    filesRole: "reference",
    filesQuery: "design & notes",
    fileId: "file-1",
    path: "docs/a.txt",
    filesPanel: "linked_tasks",
    filesNav: "tree",
  });
  const href = new URLSearchParams(
    taskFilesHref(`?${origin}`, "task-2", "file-1"),
  );
  assert.equal(href.get("drawerId"), "task-2");
  assert.equal(href.get("panelTab"), "files");
  assert.equal(href.get("fileId"), "file-1");
  assert.deepEqual(
    new URLSearchParams(filesReturnQuery(href.get("filesReturn")!)!).size,
    origin.size,
  );
  for (const [key, value] of origin)
    assert.equal(new URLSearchParams(href.get("filesReturn")!).get(key), value);
});

test("return context is bounded and cannot introduce an external route or task drawer", () => {
  assert.equal(filesReturnQuery("https://evil.example/?tab=files"), null);
  assert.equal(filesReturnQuery("tab=tasks"), null);
  assert.equal(filesReturnQuery("tab=files&path=" + "a".repeat(8192)), null);
  assert.equal(
    filesReturnQuery(
      "tab=files&redirect=https://evil.example&drawerId=other&filesReturn=nested",
    ),
    "tab=files",
  );
});

test("unknown metadata never becomes zero bytes, today's date, or a guessed author", () => {
  assert.equal(formatBytes(null), "");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatFileTimestamp(null), "Not recorded");
  assert.equal(formatFileTimestamp("not a date"), "Not recorded");
  assert.equal(
    formatFileActor({ updatedByName: "  ", updatedByUsername: "  author  " }),
    "author",
  );
  assert.equal(formatFileActor({}), "Not recorded");
});

test("extensionless images and PDFs retain MIME-aware icons", () => {
  const render = (mimeType: string) =>
    renderToStaticMarkup(
      React.createElement(FileIcon, { name: "asset", type: "file", mimeType }),
    );
  assert.notEqual(render("image/png"), render("application/octet-stream"));
  assert.notEqual(
    render("application/pdf"),
    render("application/octet-stream"),
  );
});

test("cancelled cross-tab navigation preserves the draft; discard targets only this file", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = useFilesWorkspaceStore.persist.getOptions().storage;
  useFilesWorkspaceStore.persist.setOptions({
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const events: CustomEvent[] = [];
  let accept = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      confirm: () => accept,
      dispatchEvent: (event: CustomEvent) => {
        events.push(event);
        return true;
      },
    },
  });
  const store = useFilesWorkspaceStore.getState();
  const projectId = "recovery-test";
  try {
    store.ensureProjectWorkspace(projectId);
    store.setDirtyFile(projectId, "file-1", true);
    assert.equal(confirmFileNavigation(projectId), false);
    assert.equal(
      useFilesWorkspaceStore.getState().byProjectId[projectId]?.dirtyFileId,
      "file-1",
    );
    assert.equal(events.length, 0);
    accept = true;
    assert.equal(confirmFileNavigation(projectId), true);
    assert.equal(
      useFilesWorkspaceStore.getState().byProjectId[projectId]?.dirtyFileId,
      null,
    );
    assert.equal(events[0]?.type, "project:discard-file-edits");
    assert.deepEqual(events[0]?.detail, { projectId, nodeId: "file-1" });
    assert.equal(confirmFileNavigation(projectId), true);
    assert.equal(events.length, 1);
  } finally {
    useFilesWorkspaceStore.persist.setOptions({ storage: originalStorage });
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("editor snapshot and failed notes remain recoverable without closing the editor", () => {
  const text = readFileSync(
    "src/components/projects/v2/files-tab/file/TextViewer.tsx",
    "utf8",
  );
  assert.match(text, /const loadVersion = editSnapshot.current\?\.version/);
  assert.match(text, /baseVersion,\s*baseHash,\s*lease,/);
  assert.match(text, /Retry editing access/);
  assert.doesNotMatch(text, /baseVersion: node.currentVersion/);
  const notes = readFileSync(
    "src/components/projects/v2/files-tab/file/LinkedTasksPanel.tsx",
    "utf8",
  );
  assert.match(
    notes,
    /if \(!result.success\) \{[\s\S]*?setSaveError\([\s\S]*?return;\s*\}\s*setIsEditing\(false\)/,
  );
});

test("subsequent task file pages use the query cache, not disposable local state", () => {
  const text = readFileSync(
    "src/components/projects/v2/files-tab/TaskFilesCollection.tsx",
    "utf8",
  );
  assert.match(text, /fileCursor: taskId \? pageParam : undefined/);
  assert.match(text, /getNextPageParam:[\s\S]*?nextFileCursor/);
  assert.match(text, /result.data\?\.pages.flatMap/);
  assert.doesNotMatch(text, /extraPages|setExtraPages|getTaskFileGroupPage/);
});

test(
  "upload worker publishes confirmed successes before failure and retries only failed PUTs",
  { timeout: 3000 },
  async () => {
    const source = readFileSync(
      "src/components/projects/v2/explorer/upload.worker.ts",
      "utf8",
    );
    const messages: any[] = [];
    const attempts = new Map<string, number>();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const worker = {
      onmessage: null as any,
      postMessage: (message: any) => {
        messages.push(message);
        if (message.type === "done" || message.type === "error") finish();
      },
    };
    vm.runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        self: worker,
        fetch: async (url: string) => {
          attempts.set(url, (attempts.get(url) ?? 0) + 1);
          return { ok: url === "good", status: url === "good" ? 200 : 503 };
        },
        setTimeout: (fn: () => void) => {
          fn();
        },
      },
    );
    worker.onmessage({
      data: {
        jobId: "job-1",
        uploadNodes: ["good", "bad", "missing"].map((id) => ({
          fileId: id,
          s3Key: id,
          file: { type: "text/plain" },
          path: id,
        })),
        uploadUrls: { good: "good", bad: "bad" },
      },
    });
    await done;
    assert.equal(attempts.get("good"), 1);
    assert.equal(attempts.get("bad"), 3);
    assert.equal(attempts.has("missing"), false);
    assert.equal(
      messages.some(
        (message) =>
          message.type === "progress" &&
          message.fileId === "good" &&
          message.fileSucceeded,
      ),
      true,
    );
    assert.equal(messages.at(-1).success, 1);
    assert.equal(messages.at(-1).failed, 2);
    assert.equal(messages.at(-1).results.length, 3);
  },
);
