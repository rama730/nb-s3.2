export function decodeProjectDocHtmlEntities(value: string) {
    return value
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_match, code: string) => {
            const parsed = Number.parseInt(code, 10);
            return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : " ";
        })
        .replace(/&#x([a-f0-9]+);/gi, (_match, code: string) => {
            const parsed = Number.parseInt(code, 16);
            return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : " ";
        });
}

export function buildProjectDocPlainText(content: string | null | undefined, options: {
    maxLength?: number;
    stripCodeBlocks?: boolean;
} = {}) {
    const stripCodeBlocks = options.stripCodeBlocks !== false;
    let plain = decodeProjectDocHtmlEntities(content ?? "")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/\{%\s*(?:project|ref)\.[^%]+%\}/g, " ");

    if (stripCodeBlocks) plain = plain.replace(/```[\s\S]*?```/g, " ");

    plain = plain
        .replace(/<img\b[^>\n]*(?:>|$)/gi, " ")
        .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
        .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
        .replace(/`([^`\n]+)`/g, "$1")
        .replace(/<\/?[a-z][^>\n]*(?:>|$)/gi, " ")
        .replace(/^[ \t]*#{1,6}[ \t]+/gm, " ")
        .replace(/[#>*_~|]/g, " ")
        .replace(/[ \t]*[-=]{3,}[ \t]*/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!plain) return null;
    const maxLength = options.maxLength;
    if (typeof maxLength === "number" && maxLength > 0 && plain.length > maxLength) {
        return `${plain.slice(0, maxLength - 1).trim()}…`;
    }
    return plain;
}
