import type { ProjectNode } from "@/lib/db/schema";
import { filesParentKey } from "@/stores/filesWorkspaceStore";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";

export type VisibleRow =
  | { kind: "node"; nodeId: string; level: number; parentId: string | null; indentationGuides: boolean[] }
  | { kind: "loading"; parentId: string; level: number; indentationGuides: boolean[] }
  | { kind: "load-more"; parentId: string; level: number; indentationGuides: boolean[] }
  | { kind: "empty"; level: number };

type BuildVisibleRowsParams = {
  projectId: string;
  treeVersion: number;
  mode: string;
  sort: "name" | "updated" | "type";
  foldersFirst: boolean;
  viewMode: string;
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  loadedChildren: Record<string, boolean>;
  expandedFolderIds: Record<string, boolean>;
  folderMeta: Record<string, { nextCursor: string | null; hasMore: boolean }>;
  sortedChildrenByParentId: Record<string, string[]>;
  includeNode?: (node: ProjectNode) => boolean;
};

type RowCacheEntry = {
  rows: VisibleRow[];
  createdAt: number;
  lastAccessAt: number;
};

const rowModelCache = new Map<string, RowCacheEntry>();

function evictExpiredEntries(now: number) {
  const ttlMs = FILES_RUNTIME_BUDGETS.visibleRowsCacheTtlMs;
  for (const [key, entry] of rowModelCache) {
    if (now - entry.createdAt > ttlMs) {
      rowModelCache.delete(key);
    }
  }
}

function evictLruEntries() {
  const maxKeys = FILES_RUNTIME_BUDGETS.visibleRowsCacheMaxKeys;
  if (rowModelCache.size <= maxKeys) return;
  const entries = Array.from(rowModelCache.entries()).sort(
    (a, b) => a[1].lastAccessAt - b[1].lastAccessAt
  );
  const toDelete = rowModelCache.size - maxKeys;
  for (let index = 0; index < toDelete; index += 1) {
    const key = entries[index]?.[0];
    if (key) rowModelCache.delete(key);
  }
}

export function __clearBuildVisibleRowsCacheForTests() {
  rowModelCache.clear();
}

export function buildVisibleRows(params: BuildVisibleRowsParams): VisibleRow[] {
  const {
    projectId,
    treeVersion,
    mode,
    sort,
    foldersFirst,
    viewMode,
    nodesById,
    childrenByParentId,
    loadedChildren,
    expandedFolderIds,
    folderMeta,
    sortedChildrenByParentId,
    includeNode,
  } = params;

  const now = Date.now();
  evictExpiredEntries(now);

  const cacheKey = `${projectId}:${treeVersion}:${mode}:${sort}:${foldersFirst ? 1 : 0}:${viewMode}:${includeNode ? 'filtered' : 'all'}`;
  const cached = rowModelCache.get(cacheKey);
  if (cached) {
    cached.lastAccessAt = now;
    return cached.rows;
  }

  const rows: VisibleRow[] = [];

  const walk = (parentId: string | null, level: number, ancestors: boolean[]) => {
    const key = filesParentKey(parentId);
    // Pure Optimization: Access presorted lists from Web Worker in O(1) instead of CPU-blocking Array.sort
    const childIds = sortedChildrenByParentId[key] || childrenByParentId[key] || [];

    const seenNames = new Set<string>();
    const sorted = childIds.filter((id) => {
      const n = nodesById[id];
      if (!n) return false;
      if (seenNames.has(n.name)) return false;
      const include = includeNode ? includeNode(n) : true;
      if (include) seenNames.add(n.name);
      return include;
    });

    if (level === 0 && sorted.length === 0) {
      rows.push({ kind: "empty", level: 0 });
      return;
    }

    for (let i = 0; i < sorted.length; i += 1) {
      const id = sorted[i];
      const meta = folderMeta[filesParentKey(parentId)];
      const hasMore = !!meta?.hasMore;
      const isLastFile = i === sorted.length - 1;
      const isVisuallyLastInfo = hasMore ? false : isLastFile;

      rows.push({ kind: "node", nodeId: id, level, parentId, indentationGuides: ancestors });
      const node = nodesById[id];
      if (node?.type === "folder" && expandedFolderIds[id]) {
        const childKey = filesParentKey(id);
        const loaded = !!loadedChildren[childKey];
        const nextAncestors = [...ancestors, !isVisuallyLastInfo];
        if (!loaded) {
          rows.push({ kind: "loading", parentId: id, level: level + 1, indentationGuides: nextAncestors });
        } else {
          walk(id, level + 1, nextAncestors);
        }
      }
    }

    const meta = folderMeta[filesParentKey(parentId)];
    if (meta?.hasMore) {
      rows.push({ kind: "load-more", parentId: parentId ?? "root", level, indentationGuides: ancestors });
    }
  };

  walk(null, 0, []);
  rowModelCache.set(cacheKey, {
    rows,
    createdAt: now,
    lastAccessAt: now,
  });
  evictLruEntries();
  return rows;
}
