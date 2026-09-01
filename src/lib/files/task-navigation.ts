const FILES_PARAMS = [
  "path",
  "fileId",
  "filesView",
  "filesTask",
  "filesRole",
  "filesQuery",
  "filesGroupQuery",
  "filesNav",
  "filesPanel",
  "fromTab",
];

/** Return context contains only same-project Files parameters, never a redirect URL. */
export function filesReturnQuery(query: string): string | null {
  if (query.length > 8192) return null;
  const source = new URLSearchParams(query);
  if (source.get("tab") !== "files") return null;
  const result = new URLSearchParams({ tab: "files" });
  for (const key of FILES_PARAMS) {
    const value = source.get(key);
    if (value) result.set(key, value);
  }
  return result.toString();
}

export function taskFilesHref(
  currentQuery: string,
  taskId: string,
  nodeId?: string,
): string {
  const params = new URLSearchParams({
    tab: "tasks",
    drawerType: "task",
    drawerId: taskId,
    panelTab: "files",
  });
  if (nodeId) params.set("fileId", nodeId);
  const origin = filesReturnQuery(currentQuery);
  if (origin) params.set("filesReturn", origin);
  return `?${params}`;
}
