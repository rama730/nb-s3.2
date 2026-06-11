import type { ProjectReadmeHeading } from "@/lib/projects/readme";
import { buildProjectReadmePlainText } from "@/lib/projects/readme-plain-text";
import { projectReadmeCommandBlockId, projectReadmeCommandLineTargetId } from "@/lib/projects/readme-navigation";

export type ProjectReadmeCommandTargetKind = "block" | "inline";
export type ProjectReadmeCommandRiskLevel = "none" | "caution" | "danger";
export type ProjectReadmeCommandConfidence = "high" | "medium" | "low";
export type ProjectReadmeCommandGroup =
    | "recommended"
    | "install"
    | "claude"
    | "agents"
    | "config"
    | "options"
    | "uninstall"
    | "develop"
    | "quality"
    | "deploy"
    | "database"
    | "other";

export type ProjectReadmeQuickCommand = {
    id: string;
    blockId: string;
    targetId: string;
    targetKind: ProjectReadmeCommandTargetKind;
    blockIndex: number;
    commandIndex: number;
    codeLineStart: number | null;
    codeLineEnd: number | null;
    command: string;
    label: string;
    group: ProjectReadmeCommandGroup;
    groupLabel: string;
    detail: string | null;
    language: string | null;
    heading: string | null;
    platforms: string[];
    ecosystemTags: string[];
    confidence: ProjectReadmeCommandConfidence;
    confidenceLabel: string;
    riskLevel: ProjectReadmeCommandRiskLevel;
    riskLabel: string | null;
};

export type ProjectReadmeRailReport = {
    summary: string | null;
    briefItems: Array<{ label: string; value: string }>;
    summaryItems: Array<{ label: string; value: string }>;
    nextAction: string | null;
    warnings: string[];
    limitations: string[];
    signals: string[];
    platforms: string[];
    readiness: "empty" | "weak" | "actionable";
    commandCount: number;
    projectLinkCount: number;
    optionCount: number;
};

export type ProjectReadmeQuickConsoleSummary = {
    commands: ProjectReadmeQuickCommand[];
    headings: ProjectReadmeHeading[];
    report: ProjectReadmeRailReport;
};

const FENCED_CODE_BLOCK_REGEX = /```([a-zA-Z0-9_-]+)?[^\n]*\n([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /(^|[^`])`([^`\n]+)`(?!`)/g;
const HEADING_REGEX = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const COMMAND_LANGUAGES = new Set([
    "bash",
    "sh",
    "shell",
    "zsh",
    "terminal",
    "console",
    "powershell",
    "ps1",
]);
const CONFIG_LANGUAGES = new Set(["json", "jsonc", "toml", "yaml", "yml"]);
const COMMAND_START_REGEX = /^(?:sudo|npm|pnpm|yarn|bun|npx|node|git|gh|vercel|docker|docker-compose|curl|wget|brew|pip|pipx|python|uv|tsx|ts-node|make|cargo|go|psql|redis-cli|supabase|drizzle-kit|claude|gemini|code|cursor|windsurf|cline|copilot|tessl|cd|cp|mv|mkdir|rm|chmod|chown|export|source|eval|echo|cat|sed|awk|ssh|scp|rsync|tar|unzip|bash|sh|zsh|irm|powershell)\b/i;

export const PROJECT_README_PRIMARY_COMMAND_GROUPS = new Set<ProjectReadmeCommandGroup>([
    "recommended",
    "install",
    "claude",
    "agents",
    "uninstall",
    "develop",
    "quality",
    "deploy",
    "database",
    "other",
]);

type ProjectReadmeCommandTarget = {
    id: string;
    kind: ProjectReadmeCommandTargetKind;
    offset: number;
    line: number;
    blockIndex: number;
    code: string;
    language: string | null;
};

type ProjectReadmeExtractedCommand = {
    command: string;
    startLine: number | null;
    endLine: number | null;
};

function cleanHeadingText(value: string) {
    const text = buildProjectReadmePlainText(value, { maxLength: 96, stripCodeBlocks: false });
    if (!text) return null;
    if (/^(?:align|src|width|height|alt)\b/i.test(text)) return null;
    return text;
}

function findNearestHeading(content: string, index: number) {
    const before = content.slice(0, index).split("\n");
    for (let pointer = before.length - 1; pointer >= 0; pointer -= 1) {
        const match = HEADING_REGEX.exec(before[pointer]?.trim() ?? "");
        if (match) return cleanHeadingText(match[2] ?? "");
    }
    return null;
}

function isCommentLine(line: string) {
    const trimmed = line.trim();
    return trimmed.startsWith("#") || trimmed.startsWith("//");
}

function isDecorativeHtmlLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (!/^<\/?[a-z][\s>]/i.test(trimmed)) return false;
    return /<(?:img|picture|source|p|div|span|br|hr|h[1-6])\b/i.test(trimmed);
}

function isShellLikeCommand(line: string) {
    const trimmed = line.trim();
    if (!trimmed || isCommentLine(trimmed) || isDecorativeHtmlLine(trimmed)) return false;
    return COMMAND_START_REGEX.test(trimmed)
        || /^[A-Z_][A-Z0-9_]*=.*\s+\w+/i.test(trimmed);
}

function isUnsafeSplitLine(line: string) {
    const trimmed = line.trim();
    return /(?:\\|&&|\|\||\||;)\s*$/.test(trimmed)
        || /^(then|do|else|fi|done|\)|\})\b/i.test(trimmed);
}

function isContinuationLine(line: string, previousLine: string | null) {
    const trimmed = line.trim();
    if (!trimmed || !previousLine) return false;
    return isUnsafeSplitLine(previousLine)
        || /^(?:\||&&|\|\||;|then|do|else|elif|fi|done|\)|\})\b/i.test(trimmed);
}

function shouldTreatAsCommandBlock(language: string | null, lines: string[]) {
    const normalizedLanguage = language?.toLowerCase() ?? "";
    if (COMMAND_LANGUAGES.has(normalizedLanguage)) return true;
    if (CONFIG_LANGUAGES.has(normalizedLanguage) && lines.some((line) => /\b(mcpServers|command|args|scripts)\b/i.test(line))) return true;
    return lines.some(isShellLikeCommand);
}

function splitCopyableCommands(code: string, language: string | null): ProjectReadmeExtractedCommand[] {
    const rawLines = code
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd());
    const meaningfulEntries = rawLines
        .map((line, index) => ({ line, index }))
        .filter((entry) => entry.line.trim().length > 0);
    const meaningfulLines = meaningfulEntries.map((entry) => entry.line);
    if (!shouldTreatAsCommandBlock(language, meaningfulLines)) return [];

    const normalizedLanguage = language?.toLowerCase() ?? "";
    if (CONFIG_LANGUAGES.has(normalizedLanguage)) {
        return [{
            command: meaningfulLines.join("\n").trim(),
            startLine: meaningfulEntries[0]?.index ?? null,
            endLine: meaningfulEntries[meaningfulEntries.length - 1]?.index ?? null,
        }];
    }

    const commands: ProjectReadmeExtractedCommand[] = [];
    let current: string[] = [];
    let currentStartLine: number | null = null;
    let currentEndLine: number | null = null;
    const flushCurrent = () => {
        const command = current.join("\n").trim();
        if (command) commands.push({ command, startLine: currentStartLine, endLine: currentEndLine });
        current = [];
        currentStartLine = null;
        currentEndLine = null;
    };

    meaningfulEntries.forEach(({ line, index }) => {
        const trimmed = line.trim();
        if (!trimmed || isCommentLine(trimmed)) return;

        if (isShellLikeCommand(trimmed)) {
            if (current.length && isContinuationLine(trimmed, current[current.length - 1] ?? null)) {
                current.push(trimmed);
                currentEndLine = index;
                return;
            }
            if (current.length && !isContinuationLine(trimmed, current[current.length - 1] ?? null)) flushCurrent();
            current = [trimmed];
            currentStartLine = index;
            currentEndLine = index;
            return;
        }

        if (current.length && isContinuationLine(trimmed, current[current.length - 1] ?? null)) {
            current.push(trimmed);
            currentEndLine = index;
            return;
        }

        flushCurrent();
    });

    flushCurrent();
    return commands.filter((entry) => Boolean(entry.command));
}

function usefulHeadingDetail(heading: string | null) {
    if (!heading) return null;
    if (heading.length > 48) return null;
    if (/^(?:install|installation|setup|quick start|get started|usage|configuration|config|options?|uninstall|run|develop|deploy|database|test|lint)$/i.test(heading)) {
        return heading;
    }
    if (/\b(?:windows|macos|linux|wsl|docker|claude|gemini|codex|cursor|windsurf|cline|copilot|mcp|config|option|global|local)\b/i.test(heading)) {
        return heading;
    }
    return null;
}

function isInlineCommandSnippet(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 260) return false;
    if (isDecorativeHtmlLine(trimmed)) return false;
    return COMMAND_START_REGEX.test(trimmed)
        || /^\/[a-z][a-z0-9_-]*(?:\s|$)/i.test(trimmed)
        || /^--[a-z0-9][a-z0-9-]*(?:\s|$)/i.test(trimmed)
        || /\b(?:claude plugin|gemini extensions|npx skills|caveman-shrink)\b/i.test(trimmed);
}

function isOffsetInsideRanges(offset: number, ranges: Array<{ start: number; end: number }>) {
    return ranges.some((range) => offset >= range.start && offset < range.end);
}

function lineTextForOffset(content: string, offset: number) {
    const lineStart = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    const lineEnd = content.indexOf("\n", offset);
    return content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
}

function isInlineOffsetInsideHtmlTag(content: string, offset: number) {
    const line = lineTextForOffset(content, offset);
    if (!/<[a-z][^>]*>/i.test(line)) return false;
    const before = line.slice(0, Math.max(0, offset - (content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1)));
    return before.lastIndexOf("<") > before.lastIndexOf(">");
}

function lineForOffset(content: string, offset: number) {
    return content.slice(0, offset).split("\n").length;
}

export function collectProjectReadmeCommandTargets(content: string): ProjectReadmeCommandTarget[] {
    const candidates: Array<Omit<ProjectReadmeCommandTarget, "id" | "blockIndex">> = [];
    const fencedRanges: Array<{ start: number; end: number }> = [];

    for (const match of content.matchAll(FENCED_CODE_BLOCK_REGEX)) {
        const language = match[1]?.trim().toLowerCase() || null;
        const offset = match.index ?? 0;
        fencedRanges.push({ start: offset, end: offset + match[0].length });
        if (!language) continue;
        candidates.push({
            kind: "block",
            offset,
            line: lineForOffset(content, offset),
            code: match[2] ?? "",
            language,
        });
    }

    for (const match of content.matchAll(INLINE_CODE_REGEX)) {
        const prefix = match[1] ?? "";
        const code = match[2]?.trim() ?? "";
        const offset = (match.index ?? 0) + prefix.length;
        if (isOffsetInsideRanges(offset, fencedRanges) || isInlineOffsetInsideHtmlTag(content, offset) || !isInlineCommandSnippet(code)) continue;
        candidates.push({
            kind: "inline",
            offset,
            line: lineForOffset(content, offset),
            code,
            language: null,
        });
    }

    return candidates
        .sort((a, b) => a.offset - b.offset)
        .map((candidate, blockIndex) => ({
            ...candidate,
            id: projectReadmeCommandBlockId(blockIndex),
            blockIndex,
        }));
}

export function buildProjectReadmeCommandTargetMaps(content: string) {
    const byOffset = new Map<number, string>();
    const byLine = new Map<number, string>();
    const inlineByOffset = new Map<number, string>();
    const inlineByLine = new Map<number, string>();
    const byLineQueue = new Map<number, string[]>();
    const inlineByLineQueue = new Map<number, string[]>();

    const pushLine = (map: Map<number, string[]>, line: number, id: string) => {
        const list = map.get(line) ?? [];
        list.push(id);
        map.set(line, list);
    };

    for (const target of collectProjectReadmeCommandTargets(content)) {
        const targetOffsetMap = target.kind === "inline" ? inlineByOffset : byOffset;
        const targetLineMap = target.kind === "inline" ? inlineByLine : byLine;
        const targetQueueMap = target.kind === "inline" ? inlineByLineQueue : byLineQueue;
        targetOffsetMap.set(target.offset, target.id);
        targetLineMap.set(target.line, target.id);
        pushLine(targetQueueMap, target.line, target.id);
    }

    return { byOffset, byLine, inlineByOffset, inlineByLine, byLineQueue, inlineByLineQueue };
}

function inferCommandGroup(command: string, heading: string | null, language: string | null): ProjectReadmeCommandGroup {
    const value = `${heading ?? ""} ${language ?? ""} ${command}`.toLowerCase();
    if (/^--[a-z0-9-]+/.test(command.trim())) return "options";
    if (/\b(start here|quick start|get started|getting started|recommended|one command)\b/.test(value)) return "recommended";
    if (/\bclaude\b|claude code|plugin install|plugin marketplace/.test(value)) return "claude";
    if (/\b(gemini|cursor|windsurf|cline|copilot|codex|opencode|roo|amp|goose|kiro|augment|continue|skills add)\b/.test(value)) return "agents";
    if (/\b(mcp|mcpservers|caveman-shrink|\"command\"\s*:|\"args\"\s*:)/.test(value)) return "config";
    if (/\b(uninstall|remove|disable)\b/.test(value)) return "uninstall";
    if (/\b(install|add|curl|irm|tessl install)\b/.test(value)) return "install";
    if (/\b(dev|develop|start|serve)\b/.test(value)) return "develop";
    if (/\b(test|vitest|jest|playwright|lint|eslint|biome|check)\b/.test(value)) return "quality";
    if (/\b(deploy|vercel)\b/.test(value)) return "deploy";
    if (/\b(db|migrate|migration|drizzle|push|psql|redis)\b/.test(value)) return "database";
    return "other";
}

export function projectReadmeCommandGroupLabel(group: ProjectReadmeCommandGroup) {
    switch (group) {
        case "recommended": return "Recommended";
        case "install": return "Install";
        case "claude": return "Claude Code";
        case "agents": return "Other agents";
        case "config": return "Config";
        case "options": return "Options";
        case "uninstall": return "Uninstall";
        case "develop": return "Run";
        case "quality": return "Verify";
        case "deploy": return "Deploy";
        case "database": return "Database";
        default: return "Commands";
    }
}

function inferCommandLabel(command: string, heading: string | null, index: number, group: ProjectReadmeCommandGroup) {
    const value = command.toLowerCase();
    if (group === "recommended") return "Start here";
    if (group === "claude") return "Claude plugin";
    if (group === "agents" && /\bcodex\b/.test(value)) return "Codex skill";
    if (group === "agents" && /\bcursor\b/.test(value)) return "Cursor install";
    if (group === "agents" && /\bwindsurf\b/.test(value)) return "Windsurf install";
    if (group === "agents" && /\bcline\b/.test(value)) return "Cline install";
    if (group === "agents" && /\bopencode\b/.test(value)) return "OpenCode install";
    if (group === "agents" && /\bgemini\b/.test(value)) return "Gemini install";
    if (group === "agents" && /\bnpx skills\b/.test(value)) return "Agent skill";
    if (group === "config") return /\bmcp\b|mcpservers|caveman-shrink/.test(value) ? "MCP config" : "Config";
    if (group === "options") return command.trim().split(/\s+/)[0] || "Option";
    if (group === "uninstall") return "Uninstall";
    if (/\b(install|add)\b/.test(value) || /\b(i|ci)\b/.test(value) && /\b(npm|pnpm|yarn|bun)\b/.test(value)) return "Install";
    if (/\b(dev|develop)\b/.test(value)) return "Run dev";
    if (/\b(start|serve)\b/.test(value)) return "Start";
    if (/\bbuild\b/.test(value)) return "Build";
    if (/\b(test|vitest|jest|playwright)\b/.test(value)) return "Test";
    if (/\b(lint|eslint|biome)\b/.test(value)) return "Lint";
    if (/\b(deploy|vercel)\b/.test(value)) return "Deploy";
    if (/\b(db|migrate|migration|drizzle|push)\b/.test(value)) return "Database";
    if (heading) return heading;
    return index === 0 ? "Command" : `Command ${index + 1}`;
}

function inferCommandDetail(command: string, heading: string | null, group: ProjectReadmeCommandGroup) {
    const value = command.toLowerCase();
    const headingDetail = usefulHeadingDetail(heading);
    if (group === "options") return headingDetail ? `Option from ${headingDetail}` : "Installer flag";
    if (group === "claude") return "Plugin install route";
    if (group === "agents") return "Agent-specific install";
    if (group === "config") return /\bmcp\b|mcpservers|caveman-shrink/.test(value) ? "MCP or config snippet" : "Configuration";
    if (/\bwindows|powershell|irm\b/.test(value)) return "Windows";
    if (/\bcurl|bash|sh\b/.test(value)) return "macOS, Linux, WSL";
    if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add)\s+-g\b/.test(value)) return "Global package";
    if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|i|ci)\b/.test(value)) return "Package install";
    return headingDetail;
}

function inferCommandPlatforms(command: string, heading: string | null, language: string | null) {
    const value = `${heading ?? ""} ${language ?? ""} ${command}`.toLowerCase();
    if (/\b(?:windows|powershell|pwsh|irm|iex)\b/.test(value)) return ["Windows"];
    if (/\b(?:macos|linux|wsl|curl|wget|bash|sh|zsh|chmod)\b/.test(value)) return ["macOS", "Linux", "WSL"];
    if (/\b(?:docker|node|npm|pnpm|yarn|bun|npx|claude|gemini|cursor|codex|windsurf)\b/.test(value)) return ["All"];
    return [];
}

function inferCommandEcosystemTags(command: string, heading: string | null, language: string | null) {
    const value = `${heading ?? ""} ${language ?? ""} ${command}`.toLowerCase();
    const tags: string[] = [];
    const add = (label: string) => {
        if (!tags.includes(label)) tags.push(label);
    };

    if (/\bclaude\b/.test(value)) add("Claude");
    if (/\bcodex\b|\bnpx\s+skills\b/.test(value)) add("Codex");
    if (/\bgemini\b/.test(value)) add("Gemini");
    if (/\bcursor\b/.test(value)) add("Cursor");
    if (/\bwindsurf\b/.test(value)) add("Windsurf");
    if (/\bcline\b/.test(value)) add("Cline");
    if (/\bcopilot\b/.test(value)) add("Copilot");
    if (/\bopencode\b|\broo\b|\bgoose\b|\bamp\b|\bkiro\b|\baugment\b|\bcontinue\b/.test(value)) add("Agent");
    if (/\b(?:npm|pnpm|yarn|bun|npx|node)\b/.test(value)) add("Node");
    if (/\bdocker(?:-compose)?\b/.test(value)) add("Docker");
    if (/\b(?:gh|github|raw\.githubusercontent\.com)\b/.test(value)) add("GitHub");
    if (/\b(?:curl|wget|bash|sh|zsh)\b/.test(value)) add("Shell");
    if (/\b(?:powershell|pwsh|irm|iex)\b/.test(value)) add("PowerShell");

    return tags.slice(0, 5);
}

function inferCommandConfidence(
    command: string,
    heading: string | null,
    language: string | null,
    group: ProjectReadmeCommandGroup,
    targetKind: ProjectReadmeCommandTargetKind,
): ProjectReadmeCommandConfidence {
    const normalizedLanguage = language?.toLowerCase() ?? "";
    const hasUsefulContext = Boolean(usefulHeadingDetail(heading));
    if (CONFIG_LANGUAGES.has(normalizedLanguage) && group === "config") return "high";
    if (COMMAND_LANGUAGES.has(normalizedLanguage) && group !== "other") return "high";
    if (isShellLikeCommand(command) && group !== "other") return "high";
    if (group === "options" && /^--[a-z0-9][a-z0-9-]*/i.test(command.trim())) return hasUsefulContext ? "high" : "medium";
    if (targetKind === "inline" && (group === "claude" || group === "agents" || group === "config")) return "medium";
    if (targetKind === "inline" && !hasUsefulContext) return "low";
    return group === "other" ? "medium" : "high";
}

function commandConfidenceLabel(confidence: ProjectReadmeCommandConfidence) {
    switch (confidence) {
        case "high": return "Direct match";
        case "medium": return "Review match";
        case "low": return "Low confidence";
        default: return "Review match";
    }
}

function inferCommandRisk(command: string): { riskLevel: ProjectReadmeCommandRiskLevel; riskLabel: string | null } {
    const value = command.toLowerCase();
    if (/\brm\s+-[rf]*r[rf]*\b/.test(value) || /\bdd\s+if=/.test(value) || /\bmkfs\b/.test(value) || /\bdrop\s+database\b/.test(value)) {
        return { riskLevel: "danger", riskLabel: "Destructive command" };
    }
    if (/\bcurl\b[\s\S]*(?:\|\s*(?:bash|sh|zsh)|>\s*\/tmp)/.test(value) || /\bwget\b[\s\S]*\|\s*(?:bash|sh|zsh)/.test(value)) {
        return { riskLevel: "caution", riskLabel: "Remote install script" };
    }
    if (/\birm\b[\s\S]*\|\s*iex\b/.test(value)) {
        return { riskLevel: "caution", riskLabel: "Remote PowerShell script" };
    }
    if (/\bsudo\b|\bchmod\s+\+x\b|\bchown\b/.test(value)) {
        return { riskLevel: "caution", riskLabel: "Elevated access" };
    }
    if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|i)\s+-g\b/.test(value) || /\bnpx\s+skills\s+add\b/.test(value)) {
        return { riskLevel: "caution", riskLabel: "Global install" };
    }
    if (/\b(?:export|setx)\s+(?:[A-Z0-9_]*TOKEN|[A-Z0-9_]*KEY|[A-Z0-9_]*SECRET)\b/i.test(command)) {
        return { riskLevel: "caution", riskLabel: "Credential environment" };
    }
    if (/\b(?:gh|vercel|npm|pnpm|yarn|docker|supabase|claude|gemini)\s+(?:auth\s+)?login\b/.test(value)) {
        return { riskLevel: "caution", riskLabel: "Account login" };
    }
    if (/\b(?:\.zshrc|\.bashrc|\.bash_profile|\.profile)\b/.test(value) && /(?:>>|>|tee)/.test(value)) {
        return { riskLevel: "caution", riskLabel: "Shell profile update" };
    }
    return { riskLevel: "none", riskLabel: null };
}

export function extractProjectReadmeCommandShortcuts(content: string): ProjectReadmeQuickCommand[] {
    const commands: ProjectReadmeQuickCommand[] = [];
    for (const target of collectProjectReadmeCommandTargets(content)) {
        const heading = findNearestHeading(content, target.offset);
        const copyableCommands = target.kind === "inline"
            ? [{ command: target.code.trim(), startLine: null, endLine: null }].filter((entry) => Boolean(entry.command))
            : splitCopyableCommands(target.code, target.language);
        copyableCommands.forEach((entry, commandIndex) => {
            const command = entry.command;
            const group = inferCommandGroup(command, heading, target.language);
            const risk = inferCommandRisk(command);
            const confidence = inferCommandConfidence(command, heading, target.language, group, target.kind);
            const targetId = target.kind === "block" && copyableCommands.length > 1
                ? projectReadmeCommandLineTargetId(target.blockIndex, commandIndex)
                : target.id;
            commands.push({
                id: `${target.id}-${commandIndex}`,
                blockId: target.id,
                targetId,
                targetKind: target.kind,
                blockIndex: target.blockIndex,
                commandIndex,
                codeLineStart: entry.startLine,
                codeLineEnd: entry.endLine,
                command,
                label: inferCommandLabel(command, heading, commandIndex, group),
                group,
                groupLabel: projectReadmeCommandGroupLabel(group),
                detail: inferCommandDetail(command, heading, group),
                language: target.language,
                heading,
                platforms: inferCommandPlatforms(command, heading, target.language),
                ecosystemTags: inferCommandEcosystemTags(command, heading, target.language),
                confidence,
                confidenceLabel: commandConfidenceLabel(confidence),
                riskLevel: risk.riskLevel,
                riskLabel: risk.riskLabel,
            });
        });
    }
    return commands;
}

function summarizeReadmeContent(content: string, excerpt?: string | null) {
    return buildProjectReadmePlainText(excerpt, { maxLength: 150 })
        ?? buildProjectReadmePlainText(content, { maxLength: 150 });
}

function inferReadmeNextAction(commands: ProjectReadmeQuickCommand[]) {
    const preferred = commands.find((command) => command.group === "recommended")
        ?? commands.find((command) => command.group === "install" || command.group === "claude" || command.group === "agents")
        ?? commands.find((command) => command.group === "develop")
        ?? commands[0];
    if (!preferred) return null;
    return `${preferred.label}: ${preferred.command.split("\n")[0]?.trim() ?? preferred.command}`;
}

function buildUniqueRiskWarnings(commands: ProjectReadmeQuickCommand[]) {
    const warnings = new Set<string>();
    commands.forEach((command) => {
        if (command.riskLevel === "none") return;
        warnings.add(command.riskLabel || `Review ${command.label}`);
    });
    return Array.from(warnings).slice(0, 3);
}

function buildUniquePlatforms(commands: ProjectReadmeQuickCommand[]) {
    const platforms = new Set<string>();
    commands.forEach((command) => {
        command.platforms.forEach((platform) => platforms.add(platform));
    });
    return Array.from(platforms).slice(0, 6);
}

function buildReadmeLimitations(input: {
    content: string;
    commands: ProjectReadmeQuickCommand[];
    references: unknown[];
    headings: ProjectReadmeHeading[];
}) {
    const limitations: string[] = [];
    const hasReadableContent = Boolean(buildProjectReadmePlainText(input.content, { maxLength: 32 }));
    if (!hasReadableContent) {
        limitations.push("README is empty");
        return limitations;
    }
    if (!input.commands.length) limitations.push("No copyable setup commands detected");
    if (!input.headings.length) limitations.push("No section outline detected");
    if (!input.references.length) limitations.push("No project links detected");
    return limitations.slice(0, 3);
}

function buildReadmeSummaryItems(input: {
    content: string;
    commands: ProjectReadmeQuickCommand[];
    references: unknown[];
    headings: ProjectReadmeHeading[];
}) {
    const items: Array<{ label: string; value: string }> = [];
    if (input.commands.length) {
        const installCount = input.commands.filter((command) => (
            command.group === "install"
            || command.group === "recommended"
            || command.group === "claude"
            || command.group === "agents"
        )).length;
        items.push({ label: "Commands", value: installCount ? `${installCount} install/setup paths` : `${input.commands.length} copyable commands` });
    }
    if (input.references.length) items.push({ label: "Links", value: `${input.references.length} project references` });
    if (input.headings.length) items.push({ label: "Outline", value: `${input.headings.length} sections` });
    if (/\b(?:benchmark|saved|saving|token|report|kvm)\b/i.test(input.content)) {
        items.push({ label: "Report", value: "README includes measurable results" });
    }
    return items.slice(0, 4);
}

function buildReadmeBriefItems(input: {
    content: string;
    excerpt?: string | null;
    commands: ProjectReadmeQuickCommand[];
    references: unknown[];
    headings: ProjectReadmeHeading[];
}) {
    const items: Array<{ label: string; value: string }> = [];
    const purpose = summarizeReadmeContent(input.content, input.excerpt);
    const nextAction = inferReadmeNextAction(input.commands);
    const setupCommands = input.commands.filter((command) => (
        command.group === "recommended"
        || command.group === "install"
        || command.group === "claude"
        || command.group === "agents"
    ));
    const platforms = buildUniquePlatforms(input.commands);
    const warnings = buildUniqueRiskWarnings(input.commands.filter((command) => command.riskLevel !== "none"));
    const limitations = buildReadmeLimitations(input);
    const lowConfidenceCount = input.commands.filter((command) => command.confidence === "low").length;

    if (purpose) items.push({ label: "Purpose", value: purpose });
    if (nextAction) items.push({ label: "Start here", value: nextAction });
    if (setupCommands.length) items.push({ label: "Setup paths", value: `${setupCommands.length} install or agent setup command${setupCommands.length === 1 ? "" : "s"}` });
    if (platforms.length) items.push({ label: "Platforms", value: platforms.join(", ") });
    if (input.headings.length) items.push({ label: "Structure", value: `${input.headings.length} README section${input.headings.length === 1 ? "" : "s"}` });
    if (input.references.length) items.push({ label: "Project links", value: `${input.references.length} linked project item${input.references.length === 1 ? "" : "s"}` });
    if (warnings.length) items.push({ label: "Review", value: warnings.join(", ") });
    if (lowConfidenceCount) items.push({ label: "Check", value: `${lowConfidenceCount} low-confidence command match${lowConfidenceCount === 1 ? "" : "es"}` });
    if (limitations.length) items.push({ label: "Missing", value: limitations.join(", ") });

    return items.slice(0, 7);
}

export function buildProjectReadmeRailReport(input: {
    content: string;
    excerpt?: string | null;
    commands: ProjectReadmeQuickCommand[];
    references: unknown[];
    headings: ProjectReadmeHeading[];
}): ProjectReadmeRailReport {
    const lower = input.content.toLowerCase();
    const optionCount = input.commands.filter((command) => command.group === "options").length;
    const riskyCommands = input.commands.filter((command) => command.riskLevel !== "none");
    const limitations = buildReadmeLimitations(input);
    const hasReadableContent = Boolean(buildProjectReadmePlainText(input.content, { maxLength: 32 }));
    const readiness = !hasReadableContent
        ? "empty"
        : input.commands.length || input.references.length || input.headings.length
            ? "actionable"
            : "weak";
    const signals = new Set<string>();
    if (input.commands.length) signals.add(`${input.commands.length} command${input.commands.length === 1 ? "" : "s"}`);
    if (input.references.length) signals.add(`${input.references.length} project link${input.references.length === 1 ? "" : "s"}`);
    if (input.headings.length) signals.add(`${input.headings.length} section${input.headings.length === 1 ? "" : "s"}`);
    if (input.commands.some((command) => command.group === "claude")) signals.add("Claude install");
    if (input.commands.some((command) => command.group === "config")) signals.add("Config");
    if (optionCount) signals.add(`${optionCount} option${optionCount === 1 ? "" : "s"}`);
    if (/\b(benchmark|saved|saving|token|report|kvm)\b/.test(lower)) signals.add("Report data");
    if (riskyCommands.length) signals.add("Review commands");

    return {
        summary: summarizeReadmeContent(input.content, input.excerpt),
        briefItems: buildReadmeBriefItems(input),
        summaryItems: buildReadmeSummaryItems(input),
        nextAction: inferReadmeNextAction(input.commands),
        warnings: buildUniqueRiskWarnings(riskyCommands),
        limitations,
        signals: Array.from(signals).slice(0, 6),
        platforms: buildUniquePlatforms(input.commands),
        readiness,
        commandCount: input.commands.length,
        projectLinkCount: input.references.length,
        optionCount,
    };
}

export function buildProjectReadmeQuickConsoleSummary(
    content: string,
    headings: ProjectReadmeHeading[],
): ProjectReadmeQuickConsoleSummary {
    const commands = extractProjectReadmeCommandShortcuts(content);
    return {
        commands,
        headings,
        report: buildProjectReadmeRailReport({
            content,
            commands,
            headings,
            references: [],
        }),
    };
}
