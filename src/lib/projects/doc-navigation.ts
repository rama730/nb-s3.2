export type ProjectDocTargetKind = "heading" | "command" | "reference";

export const PROJECT_DOC_TARGET_SELECTOR = "[data-readme-target='true']";
const FENCED_CODE_BLOCK_REGEX = /```([a-zA-Z0-9_-]+)?[^\n]*\n([\s\S]*?)```/g;

export function projectDocCommandBlockId(blockIndex: number) {
    return `readme-command-${blockIndex}`;
}

export function projectDocCommandLineTargetId(blockIndex: number, commandIndex: number) {
    return `${projectDocCommandBlockId(blockIndex)}-command-${commandIndex}`;
}

function safeReadmeTargetSegment(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "target";
}

export function projectDocReferenceTargetId(kind: string, id: string, index: number) {
    return `readme-ref-${safeReadmeTargetSegment(kind)}-${safeReadmeTargetSegment(id)}-${index}`;
}

export function decodeReadmeHashTarget(hash: string) {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!raw) return null;
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

export function buildProjectDocCommandBlockTargetMaps(content: string) {
    const byOffset = new Map<number, string>();
    const byLine = new Map<number, string>();
    let blockIndex = 0;

    for (const match of content.matchAll(FENCED_CODE_BLOCK_REGEX)) {
        const language = match[1]?.trim().toLowerCase() || null;
        if (!language) continue;
        const offset = match.index ?? 0;
        const line = content.slice(0, offset).split("\n").length;
        const id = projectDocCommandBlockId(blockIndex);
        byOffset.set(offset, id);
        byLine.set(line, id);
        blockIndex += 1;
    }

    return { byOffset, byLine };
}
