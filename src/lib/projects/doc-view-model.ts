import {
    inlineReferencesToSmartBlocks,
    normalizeReadmeReferenceLabel,
    parseProjectDocInlineReferences,
    splitMarkdownBySmartBlocks,
    type ProjectDocInlineReference,
    type ProjectDocReferenceOption,
    type ProjectDocSmartBlock,
} from "@/lib/projects/doc-blocks";
import { extractProjectDocHeadings, type ProjectDocHeading } from "@/lib/projects/doc-headings";
import {
    buildProjectDocCommandTargetMaps,
    buildProjectDocRailReport,
    extractProjectDocCommandShortcuts,
    PROJECT_DOC_PRIMARY_COMMAND_GROUPS,
    type ProjectDocCommandGroup,
    type ProjectDocQuickCommand,
    type ProjectDocRailReport,
} from "@/lib/projects/doc-quick-console";
import { projectDocReferenceTargetId } from "@/lib/projects/doc-navigation";

export type ProjectDocRailTabId = "brief" | "commands" | "links" | "outline" | "config" | "options" | "search";
export type ProjectDocRailActionKind = "command" | "heading" | "reference";

export type ProjectDocRailAction = {
    id: string;
    kind: ProjectDocRailActionKind;
    railTab: ProjectDocRailTabId;
    label: string;
    description: string | null;
    targetId: string;
    copyText: string | null;
    openHref: string | null;
    sourceIndex: number;
    command?: ProjectDocQuickCommand;
    commandGroup?: ProjectDocCommandGroup;
    groupLabel?: string;
    platforms: string[];
    riskLevel?: ProjectDocQuickCommand["riskLevel"];
    riskLabel?: string | null;
    reference?: ProjectDocInlineReference;
    referencePreviewKey?: string;
    previewOption?: ProjectDocReferenceOption | null;
    previewLoading?: boolean;
    previewError?: boolean;
    heading?: ProjectDocHeading;
};

export type ProjectDocTargetRegistryEntry = {
    id: string;
    kind: "heading" | "command" | "reference";
    label: string;
    railTab: ProjectDocRailTabId;
    level?: number;
    sourceIndex: number;
};

export type ProjectDocViewModel = {
    content: string;
    excerpt: string | null;
    headings: ProjectDocHeading[];
    commands: ProjectDocQuickCommand[];
    references: ProjectDocInlineReference[];
    segments: ReturnType<typeof splitMarkdownBySmartBlocks>;
    smartBlocks: ProjectDocSmartBlock[];
    referencePreviewBlocks: ProjectDocSmartBlock[];
    previewBlocks: ProjectDocSmartBlock[];
    commandTargetMaps: ReturnType<typeof buildProjectDocCommandTargetMaps>;
    report: ProjectDocRailReport;
    railTabs: ProjectDocRailTabId[];
    railActions: ProjectDocRailAction[];
    recommendedAction: ProjectDocRailAction | null;
    targetRegistry: Map<string, ProjectDocTargetRegistryEntry>;
    targetIds: string[];
    targetSignature: string;
};

const VIEW_MODEL_CACHE_LIMIT = 12;
const viewModelCache = new Map<string, ProjectDocViewModel>();

function stableReadmeHash(value: string) {
    let hash = 5381;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
    }
    return (hash >>> 0).toString(36);
}

function readmeViewModelCacheKey(input: {
    content: string;
    contentHash?: string | null;
    excerpt?: string | null;
    storedHeadings?: ProjectDocHeading[];
}) {
    if (input.contentHash) return `content-hash:${input.contentHash}`;
    const headingSignature = input.storedHeadings?.map((heading) => `${heading.id}:${heading.text}:${heading.level}`).join("|") ?? "";
    return [
        input.content.length,
        stableReadmeHash(input.content),
        stableReadmeHash(input.excerpt ?? ""),
        stableReadmeHash(headingSignature),
    ].join(":");
}

function rememberViewModel(key: string, model: ProjectDocViewModel) {
    if (viewModelCache.has(key)) viewModelCache.delete(key);
    viewModelCache.set(key, model);
    while (viewModelCache.size > VIEW_MODEL_CACHE_LIMIT) {
        const oldestKey = viewModelCache.keys().next().value;
        if (!oldestKey) break;
        viewModelCache.delete(oldestKey);
    }
    return model;
}

function uniquePreviewBlocks(blocks: ProjectDocSmartBlock[]) {
    const seen = new Set<string>();
    const unique: ProjectDocSmartBlock[] = [];
    for (const block of blocks) {
        const key = `${block.kind}:${block.ids.join(",")}:${block.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(block);
    }
    return unique;
}

function buildRailTabs(input: {
    report: ProjectDocRailReport;
    commands: ProjectDocQuickCommand[];
    references: ProjectDocInlineReference[];
    headings: ProjectDocHeading[];
}) {
    const tabs: Array<{ id: ProjectDocRailTabId; score: number; order: number }> = [];
    const primaryCommands = input.commands.filter((command) => PROJECT_DOC_PRIMARY_COMMAND_GROUPS.has(command.group));
    const configCommands = input.commands.filter((command) => command.group === "config");
    const optionCommands = input.commands.filter((command) => command.group === "options");
    const setupCommands = primaryCommands.filter((command) => (
        command.group === "recommended"
        || command.group === "install"
        || command.group === "claude"
        || command.group === "agents"
    ));
    const hasBrief = Boolean(input.report.summary || input.report.summaryItems.length || input.report.signals.length || input.report.nextAction);
    const add = (id: ProjectDocRailTabId, score: number) => {
        tabs.push({ id, score, order: tabs.length });
    };

    if (hasBrief) {
        add("brief", input.report.readiness === "weak" ? 100 : setupCommands.length ? 84 : 92);
    }
    if (primaryCommands.length) {
        add("commands", setupCommands.length ? 110 : 88);
    }
    if (input.headings.length) {
        add("outline", primaryCommands.length ? 82 : 94);
    }
    if (configCommands.length) {
        add("config", setupCommands.length ? 78 : 70);
    }
    if (optionCommands.length) {
        add("options", setupCommands.length ? 76 : 68);
    }
    if (input.references.length) {
        add("links", primaryCommands.length || input.headings.length ? 64 : 86);
    }

    return tabs
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map((tab) => tab.id);
}

function commandRailTab(command: ProjectDocQuickCommand): ProjectDocRailTabId {
    if (command.group === "config") return "config";
    if (command.group === "options") return "options";
    return "commands";
}

function buildRailActions(input: {
    headings: ProjectDocHeading[];
    commands: ProjectDocQuickCommand[];
    references: ProjectDocInlineReference[];
}) {
    const commandActions: ProjectDocRailAction[] = input.commands.map((command, index) => ({
        id: `command:${command.id}`,
        kind: "command",
        railTab: commandRailTab(command),
        label: command.label,
        description: command.detail,
        targetId: command.targetId,
        copyText: command.command,
        openHref: null,
        sourceIndex: index,
        command,
        commandGroup: command.group,
        groupLabel: command.groupLabel,
        platforms: command.platforms,
        riskLevel: command.riskLevel,
        riskLabel: command.riskLabel,
    }));

    const referenceActions: ProjectDocRailAction[] = input.references.map((reference, index) => ({
        id: `reference:${reference.kind}:${reference.id}:${index}`,
        kind: "reference",
        railTab: "links",
        label: normalizeReadmeReferenceLabel(reference.kind, reference.label),
        description: null,
        targetId: projectDocReferenceTargetId(reference.kind, reference.id, index),
        copyText: null,
        openHref: null,
        sourceIndex: index,
        reference,
        referencePreviewKey: `${reference.kind}:${reference.id}:${index}`,
        platforms: [],
    }));

    const headingActions: ProjectDocRailAction[] = input.headings.map((heading, index) => ({
        id: `heading:${heading.id}:${index}`,
        kind: "heading",
        railTab: "outline",
        label: heading.text,
        description: null,
        targetId: heading.id,
        copyText: null,
        openHref: null,
        sourceIndex: index,
        heading,
        platforms: [],
    }));

    return [...commandActions, ...referenceActions, ...headingActions];
}

function pickRecommendedAction(actions: ProjectDocRailAction[]) {
    const commandActions = actions.filter((action) => action.kind === "command");
    return commandActions.find((action) => action.commandGroup === "recommended")
        ?? commandActions.find((action) => action.commandGroup === "install" || action.commandGroup === "claude" || action.commandGroup === "agents")
        ?? commandActions.find((action) => action.commandGroup === "develop")
        ?? commandActions[0]
        ?? actions.find((action) => action.kind === "heading")
        ?? actions.find((action) => action.kind === "reference")
        ?? null;
}

function buildTargetRegistry(input: {
    headings: ProjectDocHeading[];
    commands: ProjectDocQuickCommand[];
    references: ProjectDocInlineReference[];
}) {
    const registry = new Map<string, ProjectDocTargetRegistryEntry>();
    input.headings.forEach((heading, index) => {
        registry.set(heading.id, {
            id: heading.id,
            kind: "heading",
            label: heading.text,
            railTab: "outline",
            level: heading.level,
            sourceIndex: index,
        });
    });

    input.commands.forEach((command, index) => {
        if (registry.has(command.targetId)) return;
        registry.set(command.targetId, {
            id: command.targetId,
            kind: "command",
            label: command.label,
            railTab: command.group === "config" ? "config" : command.group === "options" ? "options" : "commands",
            sourceIndex: index,
        });
    });

    input.references.forEach((reference, index) => {
        const id = projectDocReferenceTargetId(reference.kind, reference.id, index);
        registry.set(id, {
            id,
            kind: "reference",
            label: reference.label,
            railTab: "links",
            sourceIndex: index,
        });
    });
    return registry;
}

function stripFrontmatter(markdown: string): string {
    const trimmed = markdown.trimStart();
    if (trimmed.startsWith("---")) {
        const lines = markdown.split("\n");
        let endIdx = -1;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line !== undefined && line.trim() === "---") {
                endIdx = i;
                break;
            }
        }
        if (endIdx !== -1) {
            return lines.slice(endIdx + 1).join("\n");
        }
    }
    return markdown;
}

export function buildProjectDocViewModel(input: {
    content: string;
    contentHash?: string | null;
    excerpt?: string | null;
    storedHeadings?: ProjectDocHeading[];
    }): ProjectDocViewModel {
    const cacheKey = readmeViewModelCacheKey(input);
    const cached = viewModelCache.get(cacheKey);
    if (cached) return cached;

    const content = stripFrontmatter(input.content);
    const headingsFromContent = extractProjectDocHeadings(content);
    const headings = headingsFromContent.length ? headingsFromContent : input.storedHeadings ?? [];
    const commands = extractProjectDocCommandShortcuts(content);
    const references = parseProjectDocInlineReferences(content);
    const segments = splitMarkdownBySmartBlocks(content);
    const smartBlocks = segments.flatMap((segment) => segment.kind === "block" ? [segment.block] : []);
    const referencePreviewBlocks = inlineReferencesToSmartBlocks(references);
    const previewBlocks = uniquePreviewBlocks([
        ...smartBlocks,
        ...referencePreviewBlocks,
    ]);
    const report = buildProjectDocRailReport({
        content,
        excerpt: input.excerpt,
        commands,
        references,
        headings,
    });
    const railTabs = buildRailTabs({ report, commands, references, headings });
    const railActions = buildRailActions({ headings, commands, references });
    const recommendedAction = pickRecommendedAction(railActions);
    const targetRegistry = buildTargetRegistry({ headings, commands, references });
    const targetIds = Array.from(targetRegistry.keys());

    return rememberViewModel(cacheKey, {
        content,
        excerpt: input.excerpt ?? null,
        headings,
        commands,
        references,
        segments,
        smartBlocks,
        referencePreviewBlocks,
        previewBlocks,
        commandTargetMaps: buildProjectDocCommandTargetMaps(content),
        report,
        railTabs,
        railActions,
        recommendedAction,
        targetRegistry,
        targetIds,
        targetSignature: targetIds.join("|"),
    });
}
