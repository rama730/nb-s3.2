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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

ctx.addEventListener("message", (event: MessageEvent<SearchMessage>) => {
  const { type, id, content, query, replacement } = event.data;

  if (type === "search-replace-preview") {
    const regex = new RegExp(escapeRegex(query), "gi");
    const matches = content.match(regex);
    const occurrenceCount = matches?.length ?? 0;

    const firstMatchIndex = content.indexOf(query);
    const snippetStart = Math.max(0, firstMatchIndex - 40);
    const snippetEnd = Math.min(
      content.length,
      firstMatchIndex + query.length + 40
    );
    const beforeSnippet = content.slice(snippetStart, snippetEnd);
    const afterSnippet = beforeSnippet.replaceAll(query, replacement);

    ctx.postMessage({
      type: "search-replace-result",
      id,
      occurrenceCount,
      beforeSnippet: beforeSnippet.slice(0, 200),
      afterSnippet: afterSnippet.slice(0, 200),
    } satisfies SearchResult);
  }
});
