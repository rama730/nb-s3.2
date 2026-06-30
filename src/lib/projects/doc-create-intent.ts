import type { OpenRoleInput } from "@/lib/validations/project";

export type ProjectDocCreationMode = "detected" | "starter" | "skip";

export type ProjectDocCreationIntent = {
    mode: ProjectDocCreationMode;
    sourcePath?: string | null;
    publishOnCreate?: boolean;
    includeRoles?: boolean;
};

export type ReadmeCandidate = {
    name: string;
    path: string;
    type?: "file" | "dir";
    size?: number | null;
    excludedReason?: string | null;
};

const README_MAX_BYTES = 500 * 1024;

function basename(path: string) {
    return path.split("/").filter(Boolean).pop() || path;
}

export function isDocLikePath(pathOrName: string) {
    const raw = (pathOrName || "").trim();
    if (!raw) return false;
    const name = basename(raw).toLowerCase();
    const path = raw.toLowerCase();
    return (
        name === "readme" ||
        /^readme(?:[._-]|$)/i.test(name) ||
        /readme.*\.(md|mdx|markdown|mdown|txt)$/i.test(name) ||
        /\.(md|mdx|markdown|mdown)$/i.test(name) ||
        /(^|\/)readme(?:[._-]|$)/i.test(path) ||
        /(^|\/).*readme.*\.(md|mdx|markdown|mdown|txt)$/i.test(path)
    );
}

export function findBestReadmeCandidate<T extends ReadmeCandidate>(items: T[] | null | undefined): T | null {
    const candidates = (items || []).filter((item) => {
        if (!item || item.type === "dir") return false;
        if (item.excludedReason) return false;
        if (typeof item.size === "number" && item.size > README_MAX_BYTES) return false;
        return isDocLikePath(item.path || item.name);
    });

    if (candidates.length === 0) return null;

    return candidates
        .map((candidate) => {
            const normalizedPath = (candidate.path || candidate.name || "").replace(/^\/+/, "").toLowerCase();
            const name = basename(normalizedPath);
            let score = 0;
            if (name === "readme.md") score += 100;
            if (name.startsWith("readme")) score += 80;
            if (!normalizedPath.includes("/")) score += 50;
            if (normalizedPath.startsWith("docs/")) score += 15;
            if (/\.(md|mdx|markdown|mdown)$/i.test(name)) score += 10;
            return { candidate, score, pathLength: normalizedPath.length };
        })
        .sort((a, b) => b.score - a.score || a.pathLength - b.pathLength)[0]?.candidate ?? null;
}

function cleanLine(value: unknown, fallback = "") {
    const text = typeof value === "string" ? value : fallback;
    return text.replace(/\s+/g, " ").trim();
}

function uniqueList(values: unknown[] | undefined) {
    return Array.from(new Set((values || []).map((value) => cleanLine(value)).filter(Boolean)));
}

export function buildProjectDocStarterDraft(input: {
    title: string;
    shortDescription?: string | null;
    description?: string | null;
    projectType?: string | null;
    technologies?: string[];
    tags?: string[];
    roles?: OpenRoleInput[];
    includeRoles?: boolean;
}) {
    const title = cleanLine(input.title, "Project Doc") || "Project Doc";
    const summary = cleanLine(input.shortDescription) || cleanLine(input.description) || "Describe what this project does, who it helps, and why it exists.";
    const type = cleanLine(input.projectType);
    const technologies = uniqueList(input.technologies);
    const tags = uniqueList(input.tags);
    const roles = (input.roles || [])
        .map((role) => ({
            role: cleanLine(role.role),
            count: Number.isFinite(role.count) ? role.count : 1,
            description: cleanLine(role.description),
        }))
        .filter((role) => role.role);

    const lines = [
        `# ${title}`,
        "",
        summary,
        "",
        "## Getting started",
        "",
        "```sh",
        "npm install",
        "npm run dev",
        "```",
        "",
        "## Project focus",
        "",
    ];

    if (type) lines.push(`- Type: ${type}`);
    if (technologies.length > 0) lines.push(`- Stack: ${technologies.join(", ")}`);
    if (tags.length > 0) lines.push(`- Tags: ${tags.join(", ")}`);
    if (!type && technologies.length === 0 && tags.length === 0) {
        lines.push("- Add the project scope, stack, and important links here.");
    }

    if (input.includeRoles !== false && roles.length > 0) {
        lines.push("", "## Roles needed", "");
        for (const role of roles) {
            const count = role.count > 1 ? `${role.count} openings` : "1 opening";
            lines.push(`- ${role.role} (${count})${role.description ? `: ${role.description}` : ""}`);
        }
    }

    lines.push("", "## Notes", "", "Add screenshots, demos, commands, and project references as the project grows.");

    return `${lines.join("\n").trim()}\n`;
}
