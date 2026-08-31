export const TASK_WORKING_FILES_TITLE = "Task files";

export type TaskWorkingFilesNodeLike = {
  name: string;
  path?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown> | null;
};

function normalizedPath(node: TaskWorkingFilesNodeLike) {
  return typeof node.path === "string"
    ? node.path.replace(/\/+$/, "") || "/"
    : null;
}

export function isProjectSystemRoot(node: TaskWorkingFilesNodeLike) {
  const path = normalizedPath(node);
  return (
    path === "/.system" || (node.parentId == null && node.name === ".system")
  );
}

export function isTaskWorkingFilesCollection(node: TaskWorkingFilesNodeLike) {
  return normalizedPath(node) === "/.system/tasks";
}

export function isTaskWorkingFilesTaskFolder(node: TaskWorkingFilesNodeLike) {
  const path = normalizedPath(node);
  return Boolean(path && /^\/\.system\/tasks\/[^/]+$/.test(path));
}

export function isInternalTaskWorkingFilesNode(node: TaskWorkingFilesNodeLike) {
  const path = normalizedPath(node);
  return path === "/.system" || Boolean(path?.startsWith("/.system/"));
}

export function getTaskWorkingFilesDisplayName(node: TaskWorkingFilesNodeLike) {
  const configured = node.metadata?.taskWorkingFilesDisplayName;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  if (isTaskWorkingFilesCollection(node)) return TASK_WORKING_FILES_TITLE;
  if (isTaskWorkingFilesTaskFolder(node)) return TASK_WORKING_FILES_TITLE;
  return node.name;
}
