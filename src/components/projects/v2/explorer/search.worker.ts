import type {
    SearchWorkerRequest,
    SearchWorkerResponse,
} from "./workerContracts";

let invertedIndex: Record<string, Set<string>> = {};
let documentMap: Record<string, { name: string }> = {};
const queryCache = new Map<string, Set<string>>();

function generateTriGrams(text: string): string[] {
    const chars = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (chars.length < 3) return [chars];
    const grams = [];
    for (let i = 0; i <= chars.length - 3; i++) {
        grams.push(chars.slice(i, i + 3));
    }
    return grams;
}

self.addEventListener("message", (e: MessageEvent<SearchWorkerRequest>) => {
    const { type, payload } = e.data;

    // Phase 5: O(1) Web-Worker Inverted Search Index
    if (type === "INIT_INDEX") {
        invertedIndex = {};
        documentMap = {};
        queryCache.clear();
        const { nodesById } = payload;

        for (const [id, node] of Object.entries(nodesById) as [string, any][]) {
            documentMap[id] = { name: node.name };
            const grams = generateTriGrams(node.name);
            for (const gram of grams) {
                if (!invertedIndex[gram]) invertedIndex[gram] = new Set();
                invertedIndex[gram].add(id);
            }
        }
        self.postMessage({ type: "INDEX_COMPLETE", count: Object.keys(documentMap).length } as SearchWorkerResponse);
    }

    if (type === "SEARCH") {
        const { query, federated, requestId, jobId } = payload;
        const effectiveJobId = jobId ?? requestId ?? 0;

        try {
            // 1. Process Backend Federated Search
            let orderedIds: string[] = [];
            let snippets: Record<string, string> = {};

            if (federated && Array.isArray(federated)) {
                orderedIds = federated.map((item) => item.nodeId);
                snippets = Object.fromEntries(
                    federated.map((item) => [item.nodeId, item.snippet])
                );
            }

            // O(1) dedup Set to avoid O(N) includes() inside the loop
            const seen = new Set(orderedIds);

            // 2. Pure O(1) Tri-gram Local Intersection
            if (query && query.length >= 2) {
                const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '');
                let localMatches: Set<string> | null = null;

                if (queryCache.has(normalizedQuery)) {
                    localMatches = queryCache.get(normalizedQuery)!;
                } else {
                    const queryGrams = generateTriGrams(normalizedQuery);
                    for (const gram of queryGrams) {
                        const matches = invertedIndex[gram] || new Set();
                        if (localMatches === null) {
                            localMatches = new Set(matches);
                        } else {
                            const intersected = new Set<string>();
                            for (const id of localMatches) {
                                if (matches.has(id)) intersected.add(id);
                            }
                            localMatches = intersected;
                        }
                    }
                    if (localMatches) {
                        if (queryCache.size > 100) {
                            const firstKey = queryCache.keys().next().value;
                            if (firstKey) queryCache.delete(firstKey);
                        }
                        queryCache.set(normalizedQuery, localMatches);
                    }
                }

                if (localMatches) {
                    for (const id of localMatches) {
                        if (!seen.has(id)) {
                            orderedIds.push(id);
                            seen.add(id);
                        }
                    }
                }
            }

            self.postMessage({
                type: "SEARCH_COMPLETE",
                orderedIds,
                snippets,
                jobId: effectiveJobId,
                requestId: effectiveJobId,
            } as SearchWorkerResponse);
        } catch (error) {
            self.postMessage({
                type: "SEARCH_ERROR",
                jobId: effectiveJobId,
                requestId: effectiveJobId,
                error: error instanceof Error ? error.message : "Search worker failed",
            } as SearchWorkerResponse);
        }
    }
});
