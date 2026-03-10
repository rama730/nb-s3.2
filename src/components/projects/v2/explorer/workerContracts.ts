export type SearchIndexNode = {
  name: string;
};

export type SearchWorkerInitMessage = {
  type: "INIT_INDEX";
  payload: {
    nodesById: Record<string, SearchIndexNode>;
    jobId?: string;
  };
};

export type SearchWorkerFederatedItem = {
  nodeId: string;
  snippet: string;
};

export type SearchWorkerSearchMessage = {
  type: "SEARCH";
  payload: {
    query: string;
    federated?: SearchWorkerFederatedItem[];
    requestId?: number;
    jobId?: number;
  };
};

export type SearchWorkerRequest = SearchWorkerInitMessage | SearchWorkerSearchMessage;

export type SearchWorkerIndexComplete = {
  type: "INDEX_COMPLETE";
  count: number;
  jobId?: string;
};

export type SearchWorkerSearchComplete = {
  type: "SEARCH_COMPLETE";
  jobId: number;
  requestId: number;
  orderedIds: string[];
  snippets: Record<string, string>;
};

export type SearchWorkerSearchError = {
  type: "SEARCH_ERROR";
  jobId: number;
  requestId: number;
  error: string;
};

export type SearchWorkerResponse =
  | SearchWorkerIndexComplete
  | SearchWorkerSearchComplete
  | SearchWorkerSearchError;

