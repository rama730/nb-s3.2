export interface MessageCodeSegment {
    type: 'code';
    content: string;
    language: string | null;
}

export interface MessageTextSegment {
    type: 'text';
    content: string;
    language: null;
}

export type MessageSegment = MessageCodeSegment | MessageTextSegment;

const FENCE_OPEN_LINE_REGEX = /^\s*```([a-zA-Z0-9_+#.-]+)?[ \t]*$/;
const FENCE_CLOSE_LINE_REGEX = /^\s*```[ \t]*$/;
const EMPTY_INLINE_FENCE_LINE_REGEX = /^\s*```([a-zA-Z0-9_+#.-]+)?```[ \t]*$/;
const MAX_DETECTION_LENGTH = 30_000;

const LANGUAGE_HINTS: Array<{ language: string; patterns: RegExp[] }> = [
    {
        language: 'tsx',
        patterns: [
            /import\s+.*\s+from\s+['"][^'"]+['"]/,
            /<[A-Z][A-Za-z0-9]*(\s|>)/,
            /React\.(memo|useMemo|useCallback|useEffect)/,
        ],
    },
    {
        language: 'cpp',
        patterns: [
            /^\s*#include\s*<[^>]+>/m,
            /\busing\s+namespace\s+std\b/,
            /\bint\s+main\s*\(/,
            /\bstd::[A-Za-z_][\w]*/,
            /\bvector\s*</,
            /^\s*(public|private|protected):\s*$/m,
            /\bstring\s+[A-Za-z_][\w]*\s*;/,
        ],
    },
    {
        language: 'ts',
        patterns: [
            /\binterface\s+[A-Za-z0-9_]+/,
            /\btype\s+[A-Za-z0-9_]+\s*=/,
            /:\s*(string|number|boolean|unknown|Record<)/,
        ],
    },
    {
        language: 'js',
        patterns: [
            /\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/,
            /\b(function|async function)\s+[A-Za-z_$][\w$]*/,
            /=>\s*[{(]/,
        ],
    },
    {
        language: 'python',
        patterns: [
            /^\s*(from\s+\S+\s+import|import\s+\S+)/m,
            /^\s*def\s+[A-Za-z_][\w]*\s*\(/m,
            /^\s*(if|elif|else|for|while|try|except|finally)\b.*:\s*$/m,
            /\b(print|input|range|len|int|str)\s*\(/,
        ],
    },
    {
        language: 'css',
        patterns: [
            /[.#][A-Za-z0-9_-]+\s*\{/,
            /\b(display|position|padding|margin|color|background|border-radius)\s*:/,
        ],
    },
    {
        language: 'html',
        patterns: [
            /<\/?[a-z][\w:-]*(\s[^>]*)?>/i,
            /<!doctype\s+html/i,
        ],
    },
    {
        language: 'sql',
        patterns: [
            /\b(select|insert|update|delete|create|alter)\b[\s\S]+\b(from|into|table|where|set)\b/i,
        ],
    },
    {
        language: 'json',
        patterns: [
            /^\s*[{[][\s\S]*[}\]]\s*$/,
        ],
    },
    {
        language: 'bash',
        patterns: [
            /^\s*(npm|pnpm|bun|yarn|git|cd|ls|mkdir|rm|cp|mv|curl)\s+/m,
            /^\s*#!\/(?:usr\/bin\/env\s+)?(?:bash|sh|zsh)/m,
        ],
    },
];

const CODE_TOKENS: RegExp[] = [
    /\b(import|export|const|let|var|function|return|class|interface|type|enum|await|async|try|catch|def|elif|except|public|private|protected)\b/,
    /[{}()[\];]/,
    /=>/,
    /^\s*#include\s*<[^>]+>/m,
    /\busing\s+namespace\s+std\b/,
    /<\/?[a-z][\w:-]*(\s[^>]*)?>/i,
    /\b(console\.log|useEffect|useMemo|useCallback|SELECT|INSERT|UPDATE|DELETE|print|input|random\.randint)\b/i,
    /^\s*(if|elif|else|for|while|try|except|finally)\b.*:\s*$/m,
    /^\s{2,}\S/m,
];

function normalizeSnippetContent(content: string) {
    return content.replace(/\r\n/g, '\n').trim();
}

function normalizeLanguageName(language: string | null | undefined): string | null {
    const normalized = language?.trim().toLowerCase();
    if (!normalized) return null;

    const aliases: Record<string, string> = {
        cxx: 'cpp',
        'c++': 'cpp',
        cpp: 'cpp',
        hpp: 'cpp',
        js: 'js',
        javascript: 'js',
        jsx: 'jsx',
        ts: 'ts',
        typescript: 'ts',
        tsx: 'tsx',
        py: 'python',
        python: 'python',
        sh: 'bash',
        shell: 'bash',
        bash: 'bash',
        zsh: 'bash',
    };

    return aliases[normalized] ?? normalized.replace(/[^a-z0-9_+#.-]/g, '');
}

export function detectCodeLanguage(content: string): string | null {
    // 1500 chars covers headers, imports, and initial declarations at a fraction of CPU cost
    const sample = normalizeSnippetContent(content).slice(0, 1500);
    if (!sample) return null;

    for (const hint of LANGUAGE_HINTS) {
        if (hint.patterns.some((pattern) => pattern.test(sample))) {
            return hint.language;
        }
    }

    return null;
}

function containsStrictFenceBlock(content: string): boolean {
    const lines = normalizeSnippetContent(content).split('\n');

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line || !FENCE_OPEN_LINE_REGEX.test(line)) continue;
        for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
            const nextLine = lines[nextIndex];
            if (nextLine && FENCE_CLOSE_LINE_REGEX.test(nextLine)) return true;
        }
    }

    return false;
}

export function looksLikeCodeSnippet(content: string): boolean {
    const sample = normalizeSnippetContent(content);
    if (!sample || sample.length > MAX_DETECTION_LENGTH) return false;
    if (containsStrictFenceBlock(sample)) return true;

    const lines = sample.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length >= 2) {
        const tokenHits = CODE_TOKENS.reduce((count, pattern) => count + (pattern.test(sample) ? 1 : 0), 0);
        const indentedLines = lines.filter((line) => /^\s{2,}\S/.test(line)).length;
        const punctuationLines = lines.filter((line) => /[{}()[\];=<>]/.test(line)).length;
        const pythonControlLines = lines.filter((line) =>
            /^\s*(def|if|elif|else|for|while|try|except|finally)\b.*:/.test(line)
            || /^\s*(print|input|return|import|from)\b/.test(line),
        ).length;
        return tokenHits >= 2
            || indentedLines >= 2
            || pythonControlLines >= 2
            || punctuationLines >= Math.ceil(lines.length * 0.5);
    }

    if (sample.length < 8 || sample.length > 240) return false;
    return CODE_TOKENS.reduce((count, pattern) => count + (pattern.test(sample) ? 1 : 0), 0) >= 2;
}

function makeCodeSegment(content: string, language?: string | null): MessageCodeSegment {
    const normalizedContent = normalizeSnippetContent(content);
    const explicitLanguage = normalizeLanguageName(language);
    const detectedLanguage = detectCodeLanguage(normalizedContent);

    return {
        type: 'code',
        content: normalizedContent,
        language: detectedLanguage ?? explicitLanguage,
    };
}

function makeTextSegment(content: string): MessageTextSegment | null {
    const normalizedContent = content.replace(/\r\n/g, '\n').trim();
    if (!normalizedContent) return null;
    return { type: 'text', content: normalizedContent, language: null };
}

function stripDuplicateLanguageLine(content: string, language: string | null): string {
    const normalizedContent = normalizeSnippetContent(content);
    if (!language) return normalizedContent;

    const lines = normalizedContent.split('\n');
    if (lines.length < 2) return normalizedContent;

    const firstLineLanguage = normalizeLanguageName(lines[0]!);
    if (firstLineLanguage !== language) return normalizedContent;

    return lines.slice(1).join('\n').trim();
}

function parseMalformedInlineFence(content: string): MessageSegment[] | null {
    const lines = normalizeSnippetContent(content).split('\n');
    const match = lines[0]?.match(EMPTY_INLINE_FENCE_LINE_REGEX);
    if (!match || lines.length < 2) return null;

    const language = normalizeLanguageName(match[1]);
    const body = stripDuplicateLanguageLine(lines.slice(1).join('\n'), language);
    if (!looksLikeCodeSnippet(body)) return null;

    return [makeCodeSegment(body, language)];
}

function parseStrictFencedSegments(content: string): { hasFence: boolean; segments: MessageSegment[] } {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const segments: MessageSegment[] = [];
    let hasFence = false;
    let textLines: string[] = [];
    let index = 0;

    const flushText = () => {
        const textSegment = makeTextSegment(textLines.join('\n'));
        if (textSegment) segments.push(textSegment);
        textLines = [];
    };

    while (index < lines.length) {
        const line = lines[index]!;
        const openMatch = line.match(FENCE_OPEN_LINE_REGEX);
        if (!openMatch) {
            textLines.push(line);
            index += 1;
            continue;
        }

        let closeIndex = -1;
        for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
            const nextLine = lines[nextIndex];
            if (nextLine && FENCE_CLOSE_LINE_REGEX.test(nextLine)) {
                closeIndex = nextIndex;
                break;
            }
        }

        if (closeIndex === -1) {
            textLines.push(line);
            index += 1;
            continue;
        }

        flushText();
        segments.push(makeCodeSegment(lines.slice(index + 1, closeIndex).join('\n'), openMatch[1]));
        hasFence = true;
        index = closeIndex + 1;
    }

    flushText();
    return { hasFence, segments };
}

function compactSegments(segments: MessageSegment[]): MessageSegment[] {
    const compacted: MessageSegment[] = [];

    for (const segment of segments) {
        if (!segment.content.trim()) continue;
        const previous = compacted.at(-1);
        if (previous?.type === 'text' && segment.type === 'text') {
            previous.content = `${previous.content}\n\n${segment.content}`.trim();
            continue;
        }
        compacted.push(segment);
    }

    return compacted;
}

function repairMisclassifiedSegments(segments: MessageSegment[]): MessageSegment[] {
    const repaired: MessageSegment[] = [];

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (!segment) continue;
        const nextSegment = segments[index + 1];

        if (segment.type === 'code' && !segment.content.trim() && nextSegment?.type === 'text') {
            const nextContent = stripDuplicateLanguageLine(nextSegment.content, segment.language);
            if (looksLikeCodeSnippet(nextContent)) {
                repaired.push(makeCodeSegment(nextContent, segment.language));
                index += 1;
                continue;
            }
        }

        if (segment.type === 'text' && nextSegment?.type === 'code') {
            const textLooksLikeCode = looksLikeCodeSnippet(segment.content);
            const codeLooksLikeCode = looksLikeCodeSnippet(nextSegment.content);
            if (textLooksLikeCode && !codeLooksLikeCode) {
                repaired.push(makeCodeSegment(segment.content, nextSegment.language));
                const textSegment = makeTextSegment(nextSegment.content);
                if (textSegment) repaired.push(textSegment);
                index += 1;
                continue;
            }
        }

        repaired.push(segment);
    }

    return compactSegments(repaired);
}

function serializeSegmentsForDraft(segments: MessageSegment[]): string {
    return segments
        .map((segment) => {
            if (segment.type === 'text') return segment.content.trim();
            const language = segment.language ?? '';
            return `\`\`\`${language}\n${segment.content.trimEnd()}\n\`\`\``;
        })
        .filter(Boolean)
        .join('\n')
        .trim();
}

export function formatDraftWithCodeSnippet(content: string): string {
    const trimmed = normalizeSnippetContent(content);
    if (!trimmed) return content.trim();

    const segments = parseMessageSegments(trimmed);
    if (!segments.some((segment) => segment.type === 'code')) return content.trim();

    return serializeSegmentsForDraft(segments);
}

export function analyzeDraftCodeSnippet(content: string): {
    formatted: string;
    length: number;
    preview: { language: string | null; lineCount: number } | null;
} {
    const trimmed = normalizeSnippetContent(content);
    if (!trimmed) {
        const formatted = content.trim();
        return { formatted, length: formatted.length, preview: null };
    }

    const segments = parseMessageSegments(trimmed);
    const codeSegment = segments.find((segment) => segment.type === 'code') ?? null;
    const formatted = codeSegment ? serializeSegmentsForDraft(segments) : content.trim();

    return {
        formatted,
        length: formatted.length,
        preview: codeSegment
            ? {
                language: codeSegment.language,
                lineCount: Math.max(1, codeSegment.content.split('\n').length),
            }
            : null,
    };
}

export function parseMessageSegments(content: string): MessageSegment[] {
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const malformedSegments = parseMalformedInlineFence(normalizedContent);
    if (malformedSegments) return malformedSegments;

    const parsed = parseStrictFencedSegments(normalizedContent);
    if (parsed.hasFence) return repairMisclassifiedSegments(parsed.segments);

    if (looksLikeCodeSnippet(normalizedContent)) return [makeCodeSegment(normalizedContent)];

    const textSegment = makeTextSegment(content);
    return textSegment ? [textSegment] : [];
}
