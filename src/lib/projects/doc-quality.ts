import type { ProjectDocQualityReport } from "@/lib/projects/doc";

const SECTION_PATTERNS = {
    overview: /(^|\n)#{1,3}\s+(overview|about|introduction)\b/i,
    setup: /(^|\n)#{1,3}\s+(getting started|setup|installation|install)\b/i,
    usage: /(^|\n)#{1,3}\s+(usage|how to use|run|demo)\b/i,
    contributing: /(^|\n)#{1,3}\s+(contributing|contribution|collaboration|how to contribute)\b/i,
    screenshots: /!\[[^\]]*\]\([^)]+\)|(^|\n)#{1,3}\s+(demo|screenshots?|preview)\b/i,
    commands: /```(?:bash|sh|shell|zsh|terminal|powershell|pwsh|npm|pnpm|yarn)?[\s\S]*?\n(?:npm|pnpm|yarn|bun|git|python|node|docker|make|cargo|go|npm run)\b/i,
};

const UNSAFE_URL_PATTERN = /\]\(\s*(javascript:|data:|vbscript:)/i;
const PROJECT_LINK_PATTERN = /\]\((\/projects\/[^)]+)\)/gi;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gi;
const HTML_IMAGE_PATTERN = /<img\b[^>]*>/gi;
const TABLE_ROW_PATTERN = /^\s*\|.+\|\s*$/gm;
const QUALITY_CACHE_LIMIT = 24;
const qualityCache = new Map<string, ProjectDocQualityReport>();

function stableQualityCacheKey(content: string) {
    let hash = 2166136261;
    for (let index = 0; index < content.length; index += 1) {
        hash ^= content.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${content.length}:${hash >>> 0}`;
}

function rememberQualityReport(key: string, report: ProjectDocQualityReport) {
    if (qualityCache.has(key)) qualityCache.delete(key);
    qualityCache.set(key, report);
    while (qualityCache.size > QUALITY_CACHE_LIMIT) {
        const oldest = qualityCache.keys().next().value;
        if (!oldest) break;
        qualityCache.delete(oldest);
    }
    return report;
}

function utf8ByteLength(value: string) {
    if (typeof Buffer !== "undefined") return Buffer.byteLength(value, "utf8");
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
    return new Blob([value]).size;
}

function readHtmlAttribute(source: string, name: string) {
    const pattern = new RegExp("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))", "i");
    const match = source.match(pattern);
    return match?.[2] ?? match?.[3] ?? match?.[4] ?? null;
}

function parsePositiveInteger(value: string | null) {
    if (!value) return null;
    const match = value.trim().match(/^(\d{1,5})(?:px)?$/i);
    if (!match) return null;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function isExternalImageSource(value: string | null) {
    return Boolean(value && /^https?:\/\//i.test(value.trim()));
}

function isBadgeSource(value: string | null, alt = "") {
    const source = value?.toLowerCase() ?? "";
    const label = alt.toLowerCase();
    return /\b(shields\.io|badge\.fury\.io|badgen\.net|img\.shields\.io)\b/.test(source)
        || /\b(badge|stars?|license|commit|build|version)\b/.test(label);
}

function analyzeReadmeVisuals(content: string) {
    let imageCount = 0;
    const missingAltSources: string[] = [];
    const externalImageSources: string[] = [];
    const unboundedImageSources: string[] = [];
    const oversizedImageSources: string[] = [];

    for (const match of content.matchAll(MARKDOWN_IMAGE_PATTERN)) {
        imageCount += 1;
        const alt = match[1]?.trim() ?? "";
        const src = match[2]?.trim() ?? "";
        if (!alt) missingAltSources.push(src || `image ${imageCount}`);
        if (isExternalImageSource(src)) externalImageSources.push(src);
        if (!isBadgeSource(src, alt)) unboundedImageSources.push(src || `image ${imageCount}`);
    }

    for (const match of content.matchAll(HTML_IMAGE_PATTERN)) {
        imageCount += 1;
        const html = match[0];
        const alt = readHtmlAttribute(html, "alt")?.trim() ?? "";
        const src = readHtmlAttribute(html, "src")?.trim() ?? "";
        const width = parsePositiveInteger(readHtmlAttribute(html, "width"));
        const height = parsePositiveInteger(readHtmlAttribute(html, "height"));
        if (!alt) missingAltSources.push(src || `image ${imageCount}`);
        if (isExternalImageSource(src)) externalImageSources.push(src);
        if ((width && width > 1200) || (height && height > 1200)) oversizedImageSources.push(src || `image ${imageCount}`);
        if (!width && !height && !isBadgeSource(src, alt)) unboundedImageSources.push(src || `image ${imageCount}`);
    }

    const imageInTable = Array.from(content.matchAll(TABLE_ROW_PATTERN))
        .some((match) => /!\[[^\]]*\]\(|<img\b/i.test(match[0]));

    return {
        imageCount,
        missingAltSources,
        externalImageSources,
        unboundedImageSources,
        oversizedImageSources,
        imageInTable,
    };
}

export function evaluateProjectDocQuality(content: string): ProjectDocQualityReport {
    const cacheKey = stableQualityCacheKey(content);
    const cached = qualityCache.get(cacheKey);
    if (cached) return cached;

    const bytes = utf8ByteLength(content);
    const sectionPresence = Object.fromEntries(
        Object.entries(SECTION_PATTERNS).map(([key, pattern]) => [key, pattern.test(content)])
    );
    const issues: ProjectDocQualityReport["issues"] = [];

    const add = (id: string, severity: "info" | "warning" | "error", label: string, description: string) => {
        issues.push({ id, severity, label, description });
    };

    if (!sectionPresence.overview) add("missing-overview", "warning", "Missing overview", "Add a short explanation of what this project does and why it matters.");
    if (!sectionPresence.setup) add("missing-setup", "warning", "Missing getting started", "Add install, setup, or first-run instructions for new collaborators.");
    if (!sectionPresence.usage) add("missing-usage", "info", "Missing usage", "Show how someone should use or run the project after setup.");
    if (!sectionPresence.contributing) add("missing-contributing", "info", "Missing contribution guide", "Explain how collaborators should participate, apply, or ask for help.");
    if (!sectionPresence.screenshots) add("missing-demo", "info", "Missing demo or screenshot", "Add a visual preview when the project benefits from one.");
    if (!sectionPresence.commands) add("missing-command", "info", "No command block", "Add copyable terminal commands for setup, test, or run steps.");
    if (UNSAFE_URL_PATTERN.test(content)) add("unsafe-url", "error", "Unsafe link", "Remove javascript:, data:, or other unsafe link protocols.");

    const visuals = analyzeReadmeVisuals(content);
    if (visuals.missingAltSources.length) add("image-missing-alt", "warning", "Image missing alt text", `Add short alt text for ${visuals.missingAltSources.slice(0, 2).join(", ")} so images remain useful for screen readers and broken-image states.`);
    if (visuals.externalImageSources.length) add("external-image", "warning", "External image source", `Check ${visuals.externalImageSources.slice(0, 2).join(", ")} or use managed Doc media when privacy and availability matter.`);
    if (visuals.unboundedImageSources.length) add("image-unbounded-size", "info", "Image without display size", `Set a sensible width for ${visuals.unboundedImageSources.slice(0, 2).join(", ")} so large visuals do not overpower the Doc.`);
    if (visuals.oversizedImageSources.length) add("image-oversized", "warning", "Oversized image dimensions", `Reduce explicit dimensions for ${visuals.oversizedImageSources.slice(0, 2).join(", ")} to stay near GitHub Doc width.`);
    if (visuals.imageInTable) add("image-table-layout", "info", "Image inside table", "Use smaller before/after widths in table cells so comparisons stay readable on narrow screens.");

    const projectLinks = Array.from(content.matchAll(PROJECT_LINK_PATTERN));
    if (projectLinks.length > 20) add("many-project-links", "info", "Many project links", "Consider grouping project links into an Important Links section.");
    if (bytes > 500 * 1024) add("too-large", "error", "Doc too large", "Keep Doc content under 500 KiB and move long docs into files.");

    const score = Math.max(0, 100 - issues.reduce((total, issue) => {
        if (issue.severity === "error") return total + 35;
        if (issue.severity === "warning") return total + 15;
        return total + 6;
    }, 0));

    return rememberQualityReport(cacheKey, { score, issues, sectionPresence, contentBytes: bytes });
}
