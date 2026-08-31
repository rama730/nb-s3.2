import type { ProjectNode } from "@/lib/db/schema";
import type { ExplorerSort } from "@/stores/files/types";
import { compareFolderListNodes } from "../../files-tab/folder/sort";

export type SortWorkerPayload = {
    jobId: string;
    nodesById: Record<string, ProjectNode>;
    childrenByParentId: Record<string, string[]>;
    sort: ExplorerSort;
    foldersFirst: boolean;
};

export type SortWorkerResult = {
    jobId: string;
    sortedChildrenByParentId: Record<string, string[]>;
};

self.onmessage = (e: MessageEvent<SortWorkerPayload>) => {
    const { jobId, nodesById, childrenByParentId, sort, foldersFirst } = e.data;

    try {
        const cmp = (a: ProjectNode, b: ProjectNode) => compareFolderListNodes(a, b, sort, foldersFirst);

        const sortedChildrenByParentId: Record<string, string[]> = {};

        for (const [parentId, childIds] of Object.entries(childrenByParentId)) {
            const nodes = childIds.map(id => nodesById[id]).filter(Boolean) as ProjectNode[];
            sortedChildrenByParentId[parentId] = nodes.sort(cmp).map(n => n.id);
        }

        self.postMessage({ jobId, sortedChildrenByParentId } as SortWorkerResult);
    } catch (err) {
        console.error("Sort Worker Error:", err);
        // Return original IDs as fallback
        self.postMessage({ jobId, sortedChildrenByParentId: childrenByParentId } as SortWorkerResult);
    }
};
