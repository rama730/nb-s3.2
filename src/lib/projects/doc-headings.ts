import { buildProjectDocPlainText } from "@/lib/projects/doc-plain-text";

export type ProjectDocHeading = {
    id: string;
    level: number;
    text: string;
};

export function slugifyReadmeHeading(value: string, existing = new Set<string>()) {
    const base = value
        .toLowerCase()
        .replace(/[`*_~[\]()>#+.!?]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "section";
    let candidate = base;
    let counter = 2;
    while (existing.has(candidate)) {
        candidate = `${base}-${counter}`;
        counter += 1;
    }
    existing.add(candidate);
    return candidate;
}

export function extractProjectDocHeadings(content: string): ProjectDocHeading[] {
    const ids = new Set<string>();
    let inFence = false;
    return content
        .split("\n")
        .map((line) => {
            if (/^\s*```/.test(line)) {
                inFence = !inFence;
                return null;
            }
            if (inFence) return null;

            const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line.trim());
            if (!match) return null;
            const text = buildProjectDocPlainText(match[2], { maxLength: 120, stripCodeBlocks: false });
            if (!text) return null;
            return {
                id: slugifyReadmeHeading(text, ids),
                level: match[1]?.length ?? 1,
                text,
            } satisfies ProjectDocHeading;
        })
        .filter((heading): heading is ProjectDocHeading => Boolean(heading));
}
