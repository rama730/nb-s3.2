export type ProjectReadmeMediaProject = {
    id?: string | null;
    visibility?: string | null;
    githubRepoUrl?: string | null;
    githubDefaultBranch?: string | null;
    importSource?: unknown;
};

export type ProjectReadmeGithubSource = {
    owner: string;
    repo: string;
    branch: string;
};

export type ProjectReadmeImageKind = "badge" | "icon" | "logo" | "diagram" | "content";
export type ProjectReadmeImageIntent = "logo" | "badge" | "screenshot" | "diagram" | "before_after" | "hero" | "inline";
export type ProjectReadmeImageSourceKind = "managed" | "project-file" | "github-path" | "external-url" | "replacement";

export type ProjectReadmeImageIntentOption = {
    id: ProjectReadmeImageIntent;
    label: string;
    description: string;
    defaultWidth: number | null;
    align: "left" | "center";
};

export const PROJECT_README_IMAGE_INTENTS: ProjectReadmeImageIntentOption[] = [
    {
        id: "logo",
        label: "Logo",
        description: "Small centered identity image at the top of the README.",
        defaultWidth: 120,
        align: "center",
    },
    {
        id: "badge",
        label: "Badge",
        description: "Compact status, license, version, or star badge.",
        defaultWidth: null,
        align: "left",
    },
    {
        id: "screenshot",
        label: "Screenshot",
        description: "Product or application screenshot with readable width.",
        defaultWidth: 960,
        align: "center",
    },
    {
        id: "diagram",
        label: "Diagram",
        description: "Architecture, workflow, chart, or report image.",
        defaultWidth: 960,
        align: "center",
    },
    {
        id: "before_after",
        label: "Before/after",
        description: "Comparison image intended for table cells or paired examples.",
        defaultWidth: 460,
        align: "left",
    },
    {
        id: "hero",
        label: "Header",
        description: "Wide opening visual that introduces the README.",
        defaultWidth: 980,
        align: "center",
    },
    {
        id: "inline",
        label: "Inline",
        description: "Small supporting image inside a paragraph or step.",
        defaultWidth: 320,
        align: "left",
    },
];

export type ProjectReadmeResolvedImage = {
    src: string | null;
    blockedReason: "invalid" | "external" | null;
    trustedExternal: boolean;
    originalSrc: string;
    kind: ProjectReadmeImageKind;
    width: number | null;
    height: number | null;
    widthPercent: number | null;
};

const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const TRUSTED_PUBLIC_README_IMAGE_HOSTS = new Set([
    "raw.githubusercontent.com",
    "github.com",
    "user-images.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "camo.githubusercontent.com",
    "avatars.githubusercontent.com",
    "img.shields.io",
    "shields.io",
    "badge.fury.io",
    "api.star-history.com",
    "star-history.com",
    "em-content.zobj.net",
]);

function normalizeBranch(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : "main";
}

export function getProjectReadmeImageIntentOption(intent: ProjectReadmeImageIntent | null | undefined) {
    return PROJECT_README_IMAGE_INTENTS.find((option) => option.id === intent) ?? PROJECT_README_IMAGE_INTENTS[2]!;
}

function escapeHtmlAttribute(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function normalizeImageMarkdownSource(value: string) {
    return value.replace(CONTROL_CHARS_REGEX, "").trim();
}

function sanitizeInlineText(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

export function buildProjectReadmeImageMarkdown(input: {
    src: string;
    alt: string;
    intent?: ProjectReadmeImageIntent | null;
    width?: number | null;
    height?: number | null;
    caption?: string | null;
    forceHtml?: boolean;
}) {
    const src = normalizeImageMarkdownSource(input.src);
    if (!src) return "";
    const alt = sanitizeInlineText(input.alt) || "Project image";
    const caption = sanitizeInlineText(input.caption ?? "");
    const intent = getProjectReadmeImageIntentOption(input.intent);
    const width = typeof input.width === "number" && Number.isFinite(input.width) && input.width > 0
        ? Math.round(input.width)
        : intent.defaultWidth;
    const height = typeof input.height === "number" && Number.isFinite(input.height) && input.height > 0
        ? Math.round(input.height)
        : null;
    const shouldUseHtml = Boolean(input.forceHtml || width || height || caption || intent.align === "center");

    if (!shouldUseHtml) {
        const escapedAlt = alt.replace(/([\\\]])/g, "\\$1");
        return `![${escapedAlt}](${src})`;
    }

    const attrs = [
        `src="${escapeHtmlAttribute(src)}"`,
        `alt="${escapeHtmlAttribute(alt)}"`,
        width ? `width="${width}"` : null,
        height ? `height="${height}"` : null,
    ].filter(Boolean).join(" ");
    const imageTag = `<img ${attrs} />`;
    if (intent.align === "center") {
        const captionLine = caption ? `\n  <br />\n  <sub>${escapeHtmlAttribute(caption)}</sub>` : "";
        return `<p align="center">\n  ${imageTag}${captionLine}\n</p>`;
    }
    if (caption) {
        return `${imageTag}\n\n<sub>${escapeHtmlAttribute(caption)}</sub>`;
    }
    return imageTag;
}

function readImportSource(project: ProjectReadmeMediaProject) {
    const importSource = project.importSource && typeof project.importSource === "object"
        ? project.importSource as Record<string, unknown>
        : {};
    const metadata = importSource.metadata && typeof importSource.metadata === "object"
        ? importSource.metadata as Record<string, unknown>
        : {};
    return { importSource, metadata };
}

function readMetadataGithubRepoUrl(metadata: Record<string, unknown>) {
    const owner = typeof metadata.githubOwner === "string" ? metadata.githubOwner.trim() : "";
    const name = typeof metadata.githubName === "string" ? metadata.githubName.trim() : "";
    return owner && name ? `https://github.com/${owner}/${name}` : null;
}

export function parseProjectReadmeGithubRepoUrl(value: unknown): Pick<ProjectReadmeGithubSource, "owner" | "repo"> | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i)
        ?? trimmed.match(/^([^/\s]+)\/([^/\s#?]+)$/);
    if (!match) return null;
    const owner = match[1]?.trim();
    const repo = match[2]?.replace(/\.git$/i, "").trim();
    return owner && repo ? { owner, repo } : null;
}

export function resolveProjectReadmeGithubSource(project: ProjectReadmeMediaProject): ProjectReadmeGithubSource | null {
    const { importSource, metadata } = readImportSource(project);
    const repoUrl = project.githubRepoUrl
        ?? (typeof importSource.repoUrl === "string" ? importSource.repoUrl : null)
        ?? (typeof metadata.normalizedRepoUrl === "string" ? metadata.normalizedRepoUrl : null)
        ?? (typeof metadata.repoUrl === "string" ? metadata.repoUrl : null)
        ?? readMetadataGithubRepoUrl(metadata);
    const repo = parseProjectReadmeGithubRepoUrl(repoUrl);
    if (!repo) return null;
    const branch = normalizeBranch(importSource.branch ?? project.githubDefaultBranch ?? metadata.branch);
    return { ...repo, branch };
}

export function parseReadmeHtmlDimension(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,5})(?:px)?$/i);
    if (!match) return null;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function parseReadmeHtmlWidthPercent(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^(\d{1,3})%$/);
    if (!match) return null;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 100 ? numeric : null;
}

function encodeGithubPath(value: string) {
    return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function normalizeRelativeReadmeAssetPath(value: string) {
    const [pathPart = "", suffix = ""] = value.split(/([?#].*)/, 2);
    const normalizedPath = pathPart
        .replace(/^\.\/+/, "")
        .replace(/^\/+/, "")
        .split("/")
        .filter(Boolean);
    if (!normalizedPath.length || normalizedPath.some((part) => part === "." || part === "..")) return null;
    return `${normalizedPath.map(encodeURIComponent).join("/")}${suffix}`;
}

function resolveGithubRawImage(value: string, source: ProjectReadmeGithubSource | null) {
    if (!source) return null;
    const relativePath = normalizeRelativeReadmeAssetPath(value);
    if (!relativePath) return null;
    return `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${encodeGithubPath(source.branch)}/${relativePath}`;
}

function normalizeProtocolRelativeImageUrl(value: string) {
    return value.startsWith("//") ? `https:${value}` : value;
}

function resolveGithubRepositoryImageUrl(url: URL, source: ProjectReadmeGithubSource | null) {
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 5) return null;
    const [owner, repo, mode] = parts;
    if (!owner || !repo || (mode !== "blob" && mode !== "raw")) return null;

    const sourceMatches = source
        && owner.toLowerCase() === source.owner.toLowerCase()
        && repo.toLowerCase() === source.repo.toLowerCase();
    const branchSegments = sourceMatches ? source.branch.split("/").filter(Boolean) : [];
    const pathStart = branchSegments.length > 0
        && parts.slice(3, 3 + branchSegments.length).join("/") === source!.branch
        ? 3 + branchSegments.length
        : 4;
    const assetPath = parts.slice(pathStart).join("/");
    if (!assetPath) return null;
    const branch = branchSegments.length > 0 && pathStart > 4 ? source!.branch : parts[3];
    if (!branch) return null;

    return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeGithubPath(branch)}/${normalizeRelativeReadmeAssetPath(assetPath) ?? encodeGithubPath(assetPath)}${url.search}`;
}

function isProjectStorageImage(value: string) {
    return value.startsWith("/api/v1/projects/") || value.startsWith("/_next/") || value.startsWith("/images/");
}

function isProjectPublic(project: ProjectReadmeMediaProject) {
    return project.visibility === "public";
}

function isTrustedReadmeImageUrl(url: URL, project: ProjectReadmeMediaProject, source: ProjectReadmeGithubSource | null) {
    if (!source || !isProjectPublic(project)) return false;
    if (!TRUSTED_PUBLIC_README_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return false;
    if (url.hostname.toLowerCase() === "raw.githubusercontent.com") {
        const [, owner, repo] = url.pathname.split("/");
        return owner?.toLowerCase() === source.owner.toLowerCase()
            && repo?.toLowerCase() === source.repo.toLowerCase();
    }
    return true;
}

function classifyReadmeImage(input: {
    src: string;
    alt?: string | null;
    title?: string | null;
    width: number | null;
    height: number | null;
}) : ProjectReadmeImageKind {
    const value = input.src.toLowerCase();
    const label = `${input.alt ?? ""} ${input.title ?? ""}`.toLowerCase();
    const width = input.width ?? 0;
    const height = input.height ?? 0;
    if (/\b(shields\.io|badge\.fury\.io|badgen\.net|img\.shields\.io)\b/.test(value) || /\b(badge|stars?|license|commit|build|version)\b/.test(label)) {
        return "badge";
    }
    if ((width > 0 && width <= 48) || (height > 0 && height <= 48)) return "icon";
    if (width > 0 && width <= 220) return "logo";
    if (/\b(star-history|chart|graph|diagram|screenshot|preview|demo)\b/.test(value) || /\b(chart|graph|diagram|screenshot|preview|demo)\b/.test(label)) {
        return "diagram";
    }
    return "content";
}

export function resolveProjectReadmeImage(input: {
    src: unknown;
    alt?: unknown;
    title?: unknown;
    width?: unknown;
    height?: unknown;
    allowExternalImages: boolean;
    project: ProjectReadmeMediaProject;
}): ProjectReadmeResolvedImage {
    const originalSrc = typeof input.src === "string" ? input.src.replace(CONTROL_CHARS_REGEX, "").trim() : "";
    const width = parseReadmeHtmlDimension(input.width);
    const height = parseReadmeHtmlDimension(input.height);
    const widthPercent = parseReadmeHtmlWidthPercent(input.width);
    const kind = classifyReadmeImage({
        src: originalSrc,
        alt: typeof input.alt === "string" ? input.alt : null,
        title: typeof input.title === "string" ? input.title : null,
        width,
        height,
    });

    if (!originalSrc || originalSrc.startsWith("#")) {
        return { src: null, blockedReason: "invalid", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
    }

    const normalizedSrc = normalizeProtocolRelativeImageUrl(originalSrc);

    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalizedSrc)) {
        if (isProjectStorageImage(normalizedSrc)) {
            return { src: normalizedSrc, blockedReason: null, trustedExternal: false, originalSrc, kind, width, height, widthPercent };
        }
        const githubSrc = resolveGithubRawImage(normalizedSrc, resolveProjectReadmeGithubSource(input.project));
        if (githubSrc) {
            return { src: githubSrc, blockedReason: null, trustedExternal: true, originalSrc, kind, width, height, widthPercent };
        }
        return { src: null, blockedReason: "invalid", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
    }

    try {
        const source = resolveProjectReadmeGithubSource(input.project);
        const parsed = new URL(normalizedSrc);
        if (!SAFE_IMAGE_PROTOCOLS.has(parsed.protocol)) {
            return { src: null, blockedReason: "invalid", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
        }
        const githubRawSrc = resolveGithubRepositoryImageUrl(parsed, source);
        const resolvedUrl = githubRawSrc ? new URL(githubRawSrc) : parsed;
        const trustedExternal = isTrustedReadmeImageUrl(resolvedUrl, input.project, source);
        if (!input.allowExternalImages && !trustedExternal) {
            return { src: null, blockedReason: "external", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
        }
        return { src: resolvedUrl.toString(), blockedReason: null, trustedExternal, originalSrc, kind, width, height, widthPercent };
    } catch {
        return { src: null, blockedReason: "invalid", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
    }
}
