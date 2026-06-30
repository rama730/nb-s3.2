export type ProjectDocEditorTargetKind =
    | "blockquote"
    | "code"
    | "command"
    | "heading"
    | "html"
    | "image"
    | "inline-code"
    | "list"
    | "paragraph"
    | "smart-block"
    | "table";

export type ProjectDocEditorSourceTarget = {
    id: string;
    kind: ProjectDocEditorTargetKind;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
};

export type ProjectDocEditorSourcePosition = {
    targetId: string;
    kind?: ProjectDocEditorTargetKind | string | null;
    line?: number | null;
    offset?: number | null;
};

const FENCE_REGEX = /^\s*```/;
const HEADING_REGEX = /^\s*#{1,6}\s+\S/;
const LIST_REGEX = /^\s*(?:[-*+]|\d+\.)\s+\S/;
const BLOCKQUOTE_REGEX = /^\s*>\s?/;
const TABLE_REGEX = /^\s*\|.+\|\s*$/;
const SMART_BLOCK_REGEX = /^\s*{%\s*project\.[a-z_]+/i;
const IMAGE_REGEX = /^\s*!\[[^\]]*]\([^)]+\)/;
const HTML_IMAGE_REGEX = /<img\b/i;
const HTML_TABLE_REGEX = /<\/?(?:table|thead|tbody|tr|td|th)\b/i;
const HTML_BLOCK_REGEX = /^\s*<\/?[a-z][\s>]/i;
const SOURCE_MAP_CACHE_LIMIT = 20;
const sourceTargetCache = new Map<string, ProjectDocEditorSourceTarget[]>();

function stableSourceMapKey(content: string) {
    let hash = 2166136261;
    for (let index = 0; index < content.length; index += 1) {
        hash ^= content.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${content.length}:${hash >>> 0}`;
}

function rememberSourceTargets(key: string, targets: ProjectDocEditorSourceTarget[]) {
    if (sourceTargetCache.has(key)) sourceTargetCache.delete(key);
    sourceTargetCache.set(key, targets);
    while (sourceTargetCache.size > SOURCE_MAP_CACHE_LIMIT) {
        const oldest = sourceTargetCache.keys().next().value;
        if (!oldest) break;
        sourceTargetCache.delete(oldest);
    }
    return targets;
}

function sanitizeTargetKind(kind: string) {
    return kind.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "block";
}

export function projectDocEditorTargetId(
    kind: ProjectDocEditorTargetKind | string,
    line: number | null | undefined,
    offset: number | null | undefined,
) {
    const safeLine = Number.isFinite(line) && line ? Math.max(1, Math.trunc(line)) : 1;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset ?? 0)) : "line";
    return `readme-editor-${sanitizeTargetKind(kind)}-${safeLine}-${safeOffset}`;
}

export function getDocLineStartOffset(content: string, line: number | null | undefined) {
    const targetLine = Number.isFinite(line) && line ? Math.max(1, Math.trunc(line)) : 1;
    let offset = 0;
    let currentLine = 1;
    while (currentLine < targetLine && offset < content.length) {
        const nextBreak = content.indexOf("\n", offset);
        if (nextBreak === -1) return content.length;
        offset = nextBreak + 1;
        currentLine += 1;
    }
    return Math.min(offset, content.length);
}

function lineKind(line: string): ProjectDocEditorTargetKind {
    if (HEADING_REGEX.test(line)) return "heading";
    if (SMART_BLOCK_REGEX.test(line)) return "smart-block";
    if (IMAGE_REGEX.test(line) || HTML_IMAGE_REGEX.test(line)) return "image";
    if (TABLE_REGEX.test(line) || HTML_TABLE_REGEX.test(line)) return "table";
    if (LIST_REGEX.test(line)) return "list";
    if (BLOCKQUOTE_REGEX.test(line)) return "blockquote";
    if (HTML_BLOCK_REGEX.test(line)) return "html";
    return "paragraph";
}

function isBlockBoundary(line: string) {
    const trimmed = line.trim();
    return !trimmed
        || FENCE_REGEX.test(line)
        || HEADING_REGEX.test(line)
        || SMART_BLOCK_REGEX.test(line)
        || IMAGE_REGEX.test(line)
        || HTML_IMAGE_REGEX.test(line)
        || TABLE_REGEX.test(line)
        || HTML_TABLE_REGEX.test(line)
        || LIST_REGEX.test(line)
        || BLOCKQUOTE_REGEX.test(line)
        || HTML_BLOCK_REGEX.test(line);
}

function isIndentedContinuation(line: string) {
    return /^\s{2,}\S/.test(line)
        && !FENCE_REGEX.test(line)
        && !HEADING_REGEX.test(line)
        && !SMART_BLOCK_REGEX.test(line);
}

function continuesSourceBlock(kind: ProjectDocEditorTargetKind, line: string) {
    if (!line.trim()) return false;
    if (kind === "list") return LIST_REGEX.test(line) || isIndentedContinuation(line);
    if (kind === "blockquote") return BLOCKQUOTE_REGEX.test(line) || isIndentedContinuation(line);
    if (kind === "table") return TABLE_REGEX.test(line) || HTML_TABLE_REGEX.test(line) || isIndentedContinuation(line);
    if (kind === "html") {
        if (HEADING_REGEX.test(line) || FENCE_REGEX.test(line) || SMART_BLOCK_REGEX.test(line)) return false;
        return HTML_BLOCK_REGEX.test(line) || HTML_IMAGE_REGEX.test(line) || HTML_TABLE_REGEX.test(line) || isIndentedContinuation(line);
    }
    return false;
}

function pushTarget(
    targets: ProjectDocEditorSourceTarget[],
    kind: ProjectDocEditorTargetKind,
    startLine: number,
    endLine: number,
    startOffset: number,
    endOffset: number,
) {
    targets.push({
        id: projectDocEditorTargetId(kind, startLine, startOffset),
        kind,
        startOffset,
        endOffset,
        startLine,
        endLine,
    });
}

export function buildProjectDocEditorSourceTargets(content: string) {
    const cacheKey = stableSourceMapKey(content);
    const cached = sourceTargetCache.get(cacheKey);
    if (cached) return cached;

    const lines = content.split("\n");
    const offsets: number[] = [];
    let runningOffset = 0;
    lines.forEach((line) => {
        offsets.push(runningOffset);
        runningOffset += line.length + 1;
    });

    const targets: ProjectDocEditorSourceTarget[] = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index] ?? "";
        const trimmed = line.trim();
        const startOffset = offsets[index] ?? content.length;
        const startLine = index + 1;

        if (!trimmed) {
            index += 1;
            continue;
        }

        if (FENCE_REGEX.test(line)) {
            let endIndex = index;
            while (endIndex + 1 < lines.length) {
                endIndex += 1;
                if (FENCE_REGEX.test(lines[endIndex] ?? "")) break;
            }
            const endOffset = Math.min(content.length, (offsets[endIndex] ?? startOffset) + (lines[endIndex] ?? "").length);
            pushTarget(targets, "command", startLine, endIndex + 1, startOffset, endOffset);
            index = endIndex + 1;
            continue;
        }

        const kind = lineKind(line);
        if (kind !== "paragraph") {
            let endIndex = index;
            if (kind === "list" || kind === "blockquote" || kind === "table" || kind === "html") {
                while (endIndex + 1 < lines.length) {
                    const nextLine = lines[endIndex + 1] ?? "";
                    if (continuesSourceBlock(kind, nextLine)) endIndex += 1;
                    else break;
                }
            }
            const endOffset = Math.min(content.length, (offsets[endIndex] ?? startOffset) + (lines[endIndex] ?? "").length);
            pushTarget(targets, kind, startLine, endIndex + 1, startOffset, endOffset);
            index = endIndex + 1;
            continue;
        }

        let endIndex = index;
        while (endIndex + 1 < lines.length && !isBlockBoundary(lines[endIndex + 1] ?? "")) {
            endIndex += 1;
        }
        const endOffset = Math.min(content.length, (offsets[endIndex] ?? startOffset) + (lines[endIndex] ?? "").length);
        pushTarget(targets, "paragraph", startLine, endIndex + 1, startOffset, endOffset);
        index = endIndex + 1;
    }

    return rememberSourceTargets(cacheKey, targets);
}

export function findProjectDocEditorSourceTarget(
    targets: ProjectDocEditorSourceTarget[],
    offset: number,
) {
    if (!targets.length) return null;
    const normalizedOffset = Math.max(0, Math.trunc(offset));
    let nearest: ProjectDocEditorSourceTarget | null = null;

    for (const target of targets) {
        if (normalizedOffset >= target.startOffset && normalizedOffset <= target.endOffset) return target;
        if (target.startOffset <= normalizedOffset) nearest = target;
        if (target.startOffset > normalizedOffset) break;
    }

    return nearest ?? targets[0] ?? null;
}
