export type ProjectReadmeReferenceKind = "roles" | "contributors" | "files" | "tasks" | "sprints";
export type ProjectReadmeSmartBlockKind = ProjectReadmeReferenceKind | "unknown";

export type ProjectReadmeSmartBlock = {
    raw: string;
    kind: ProjectReadmeSmartBlockKind;
    ids: string[];
    index: number;
};

export type ProjectReadmeInlineReference = {
    raw: string;
    kind: ProjectReadmeReferenceKind;
    id: string;
    label: string;
    index: number;
};

export type ProjectReadmeReferenceOption = {
    id: string;
    kind: ProjectReadmeReferenceKind;
    title: string;
    kindLabel?: string | null;
    subtitle?: string | null;
    status?: string | null;
    meta?: string | null;
    context?: string | null;
    badges?: string[];
    avatarUrl?: string | null;
    href?: string | null;
};

export type ProjectReadmeSmartBlockPreview = {
    key: string;
    kind: ProjectReadmeSmartBlockKind;
    title: string;
    description: string;
    href?: string | null;
    items: ProjectReadmeReferenceOption[];
    unavailableCount: number;
    safeUnavailable?: boolean;
};

const SMART_BLOCK_REGEX = /\{%\s*project\.([a-z_]+)([^%]*)%\}/gi;
const INLINE_REFERENCE_REGEX = /\{%\s*ref\.([a-z_]+)\s+id="([^"]+)"(?:\s+label="([^"]*)")?\s*%\}/gi;
const IDS_REGEX = /\bids\s*=\s*"([^"]+)"/i;
const INLINE_REFERENCE_HREF_PREFIX = "/__readme-ref/";

function fallbackReferenceLabel(kind: ProjectReadmeReferenceKind) {
    const singular = kind.endsWith("s") ? kind.slice(0, -1) : kind;
    return `${singular || "project"} reference`;
}

export function normalizeReadmeReferenceLabel(kind: ProjectReadmeReferenceKind, value: string | null | undefined) {
    const clean = unescapeReadmeReferenceLabel(value ?? "").replace(/\s+/g, " ").trim();
    const fallback = fallbackReferenceLabel(kind);
    if (!clean || /^[a-f0-9-]{24,}$/i.test(clean)) return fallback;
    if (clean.toLowerCase() === fallback.toLowerCase()) return fallback;

    if (kind === "tasks") {
        const title = clean
            .replace(/^task\s*#?\s*\d+\s*[:.\-–—]\s*/i, "")
            .replace(/^task\s*:\s*/i, "")
            .trim();
        return `Task: ${title || "Untitled task"}`;
    }

    if (kind === "sprints") {
        const title = clean
            .replace(/^sprint\s*#?\s*\d+\s*[:.\-–—]\s*/i, "")
            .replace(/^sprint\s*:\s*/i, "")
            .trim();
        return `Sprint: ${title || "Untitled sprint"}`;
    }

    if (kind === "files") {
        return clean
            .replace(/\s*·\s*\d+\s+versions?$/i, "")
            .replace(/\s*(?:[·.-]\s*)?(?:version|v)\s*\d+$/i, "")
            .trim() || "Project file";
    }

    if (kind === "contributors") {
        return clean
            .replace(/\s*[·-]\s*@[\w.-]+$/i, "")
            .replace(/\s*·\s*(?:owner|co-leader|member|viewer|contributor)(?:\s*·.*)?$/i, "")
            .trim() || "Project member";
    }

    if (kind === "roles") {
        const base = clean.split("·")[0]?.trim() || "Open role";
        const capacity = clean.match(/\b(\d+\s*\/\s*\d+)\b/);
        const capacityLabel = capacity?.[1];
        if (capacityLabel && !/\(\s*\d+\s*\/\s*\d+\s*\)/.test(base)) {
            return `${base} (${capacityLabel.replace(/\s+/g, "")})`;
        }
        return base.replace(/\s*·\s*(?:open|filled|open for applications|closed).*$/i, "").trim() || "Open role";
    }

    return clean;
}

function normalizeSmartBlockKind(value: string): ProjectReadmeSmartBlockKind {
    if (value === "roles" || value === "contributors" || value === "files" || value === "tasks" || value === "sprints") {
        return value;
    }
    return "unknown";
}

function normalizeReferenceKind(value: string): ProjectReadmeReferenceKind | null {
    const kind = normalizeSmartBlockKind(value);
    return kind === "unknown" ? null : kind;
}

export function escapeReadmeReferenceLabel(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, "&quot;").replace(/\s+/g, " ").trim();
}

export function unescapeReadmeReferenceLabel(value: string) {
    return value.replace(/&quot;/g, '"').replace(/\\\\/g, "\\").trim();
}

export function buildInlineReadmeReference(option: ProjectReadmeReferenceOption) {
    return `{% ref.${option.kind} id="${option.id}" label="${escapeReadmeReferenceLabel(normalizeReadmeReferenceLabel(option.kind, option.title))}" %}`;
}

export function readmeReferenceHref(kind: ProjectReadmeReferenceKind, id: string) {
    return `${INLINE_REFERENCE_HREF_PREFIX}${kind}/${id}`;
}

export function parseReadmeReferenceHref(value: string | null | undefined): { kind: ProjectReadmeReferenceKind; id: string } | null {
    if (!value?.startsWith(INLINE_REFERENCE_HREF_PREFIX)) return null;
    const rest = value.slice(INLINE_REFERENCE_HREF_PREFIX.length);
    const [kindValue, id] = rest.split("/");
    const kind = normalizeReferenceKind(kindValue ?? "");
    if (!kind || !id) return null;
    return { kind, id };
}

export function parseProjectReadmeSmartBlocks(content: string): ProjectReadmeSmartBlock[] {
    return Array.from(content.matchAll(SMART_BLOCK_REGEX)).map((match, index) => {
        const raw = match[0];
        const kind = normalizeSmartBlockKind(match[1]?.toLowerCase() ?? "");
        const idsMatch = IDS_REGEX.exec(match[2] ?? "");
        const ids = idsMatch?.[1]
            ? idsMatch[1].split(",").map((id) => id.trim()).filter(Boolean)
            : [];
        return { raw, kind, ids, index };
    });
}

export function parseProjectReadmeInlineReferences(content: string): ProjectReadmeInlineReference[] {
    return Array.from(content.matchAll(INLINE_REFERENCE_REGEX)).flatMap((match, index) => {
        const raw = match[0];
        const kind = normalizeReferenceKind(match[1]?.toLowerCase() ?? "");
        const id = match[2]?.trim();
        if (!kind || !id) return [];
        const label = normalizeReadmeReferenceLabel(kind, match[3] || fallbackReferenceLabel(kind));
        return [{ raw, kind, id, label, index }];
    });
}

export function splitMarkdownByInlineReferences(content: string) {
    const references = parseProjectReadmeInlineReferences(content);
    if (references.length === 0) return [{ kind: "markdown" as const, content }];

    const segments: Array<
        | { kind: "markdown"; content: string }
        | { kind: "reference"; reference: ProjectReadmeInlineReference }
    > = [];
    let cursor = 0;
    for (const reference of references) {
        const index = content.indexOf(reference.raw, cursor);
        if (index < 0) continue;
        if (index > cursor) segments.push({ kind: "markdown", content: content.slice(cursor, index) });
        segments.push({ kind: "reference", reference });
        cursor = index + reference.raw.length;
    }
    if (cursor < content.length) segments.push({ kind: "markdown", content: content.slice(cursor) });
    return segments;
}

export function inlineReferencesToSmartBlocks(references: ProjectReadmeInlineReference[]): ProjectReadmeSmartBlock[] {
    return references.map((reference, index) => ({
        raw: reference.raw,
        kind: reference.kind,
        ids: [reference.id],
        index,
    }));
}

export function replaceInlineReadmeReferencesWithMarkdown(content: string) {
    return content.replace(INLINE_REFERENCE_REGEX, (raw, kindValue: string, id: string, labelValue?: string) => {
        const kind = normalizeReferenceKind(kindValue?.toLowerCase() ?? "");
        if (!kind || !id) return raw;
        const label = normalizeReadmeReferenceLabel(kind, labelValue || fallbackReferenceLabel(kind));
        return `[${label || fallbackReferenceLabel(kind)}](${readmeReferenceHref(kind, id)})`;
    });
}

export function splitMarkdownBySmartBlocks(content: string) {
    const blocks = parseProjectReadmeSmartBlocks(content);
    if (blocks.length === 0) return [{ kind: "markdown" as const, content }];
    const segments: Array<
        | { kind: "markdown"; content: string }
        | { kind: "block"; block: ProjectReadmeSmartBlock }
    > = [];
    let cursor = 0;
    for (const block of blocks) {
        const index = content.indexOf(block.raw, cursor);
        if (index < 0) continue;
        if (index > cursor) segments.push({ kind: "markdown", content: content.slice(cursor, index) });
        segments.push({ kind: "block", block });
        cursor = index + block.raw.length;
    }
    if (cursor < content.length) segments.push({ kind: "markdown", content: content.slice(cursor) });
    return segments;
}
