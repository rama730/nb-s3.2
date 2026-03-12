const ctx = self as unknown as Worker;

interface SearchMessage {
  type: "search-replace-preview";
  id: string;
  content: string;
  query: string;
  replacement: string;
}

interface SearchResult {
  type: "search-replace-result";
  id: string;
  occurrenceCount: number;
  beforeSnippet: string;
  afterSnippet: string;
}

const MAX_QUERY_LENGTH = 256;
const MAX_SCAN_CHARS = 1_000_000;
const MAX_MATCHES = 100_000;

function countLiteralMatchesCaseInsensitive(content: string, query: string): { count: number; firstMatchIndex: number } {
  const loweredContent = content.toLowerCase();
  const loweredQuery = query.toLowerCase();
  const step = Math.max(1, loweredQuery.length);
  let cursor = 0;
  let count = 0;
  let firstMatchIndex = -1;

  while (cursor < loweredContent.length && count < MAX_MATCHES) {
    const matchIndex = loweredContent.indexOf(loweredQuery, cursor);
    if (matchIndex === -1) break;
    if (firstMatchIndex === -1) firstMatchIndex = matchIndex;
    count += 1;
    cursor = matchIndex + step;
  }

  return { count, firstMatchIndex };
}

function replaceLiteralCaseInsensitive(input: string, query: string, replacement: string): string {
  if (!query) return input;
  const loweredInput = input.toLowerCase();
  const loweredQuery = query.toLowerCase();
  const queryLength = query.length;
  const parts: string[] = [];

  let cursor = 0;
  while (cursor < input.length) {
    const matchIndex = loweredInput.indexOf(loweredQuery, cursor);
    if (matchIndex === -1) {
      parts.push(input.slice(cursor));
      break;
    }
    parts.push(input.slice(cursor, matchIndex));
    parts.push(replacement);
    cursor = matchIndex + queryLength;
  }

  return parts.join("");
}

ctx.addEventListener("message", (event: MessageEvent<SearchMessage>) => {
  const { type, id, content, query, replacement } = event.data;

  if (type === "search-replace-preview") {
    const trimmedQuery = query.slice(0, MAX_QUERY_LENGTH);
    if (!trimmedQuery) {
      ctx.postMessage({
        type: "search-replace-result",
        id,
        occurrenceCount: 0,
        beforeSnippet: "",
        afterSnippet: "",
      } satisfies SearchResult);
      return;
    }

    const boundedContent = content.slice(0, MAX_SCAN_CHARS);
    const { count: occurrenceCount, firstMatchIndex } =
      countLiteralMatchesCaseInsensitive(boundedContent, trimmedQuery);
    if (firstMatchIndex < 0) {
      ctx.postMessage({
        type: "search-replace-result",
        id,
        occurrenceCount: 0,
        beforeSnippet: "",
        afterSnippet: "",
      } satisfies SearchResult);
      return;
    }

    const snippetStart = Math.max(0, firstMatchIndex - 40);
    const snippetEnd = Math.min(
      boundedContent.length,
      firstMatchIndex + trimmedQuery.length + 40
    );
    const beforeSnippet = boundedContent.slice(snippetStart, snippetEnd);
    const afterSnippet = replaceLiteralCaseInsensitive(beforeSnippet, trimmedQuery, replacement);

    ctx.postMessage({
      type: "search-replace-result",
      id,
      occurrenceCount,
      beforeSnippet: beforeSnippet.slice(0, 200),
      afterSnippet: afterSnippet.slice(0, 200),
    } satisfies SearchResult);
  }
});
