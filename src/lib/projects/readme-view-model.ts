import {
    inlineReferencesToSmartBlocks,
    normalizeReadmeReferenceLabel,
    parseProjectReadmeInlineReferences,
    splitMarkdownBySmartBlocks,
    type ProjectReadmeInlineReference,
    type ProjectReadmeReferenceOption,
    type ProjectReadmeSmartBlock,
} from "@/lib/projects/readme-blocks";
import { extractProjectReadmeHeadings, type ProjectReadmeHeading } from "@/lib/projects/readme-headings";
import {
    buildProjectReadmeCommandTargetMaps,
    buildProjectReadmeRailReport,
    extractProjectReadmeCommandShortcuts,
    PROJECT_README_PRIMARY_COMMAND_GROUPS,
    type ProjectReadmeCommandGroup,
    type ProjectReadmeQuickCommand,
    type ProjectReadmeRailReport,
} from "@/lib/projects/readme-quick-console";
import { projectReadmeReferenceTargetId } from "@/lib/projects/readme-navigation";

export type ProjectReadmeRailTabId = "brief" | "commands" | "links" | "outline" | "config" | "options";
export type ProjectReadmeRailActionKind = "command" | "heading" | "reference";

export type ProjectReadmeRailAction = {
    id: string;
    kind: ProjectReadmeRailActionKind;
    railTab: ProjectReadmeRailTabId;
    label: string;
    description: string | null;
    targetId: string;
    copyText: string | null;
    openHref: string | null;
    sourceIndex: number;
    command?: ProjectReadmeQuickCommand;
    commandGroup?: ProjectReadmeCommandGroup;
    groupLabel?: string;
    platforms: string[];
    riskLevel?: ProjectReadmeQuickCommand["riskLevel"];
    riskLabel?: string | null;
    reference?: ProjectReadmeInlineReference;
    referencePreviewKey?: string;
    previewOption?: ProjectReadmeReferenceOption | null;
    previewLoading?: boolean;
    previewError?: boolean;
    heading?: ProjectReadmeHeading;
};

export type ProjectReadmeTargetRegistryEntry = {
    id: string;
    kind: "heading" | "command" | "reference";
    label: string;
    railTab: ProjectReadmeRailTabId;
    level?: number;
    sourceIndex: number;
};

export type ProjectReadmeViewModel = {
    content: string;
    excerpt: string | null;
    headings: ProjectReadmeHeading[];
    commands: ProjectReadmeQuickCommand[];
    references: ProjectReadmeInlineReference[];
    segments: ReturnType<typeof splitMarkdownBySmartBlocks>;
    smartBlocks: ProjectReadmeSmartBlock[];
    referencePreviewBlocks: ProjectReadmeSmartBlock[];
    previewBlocks: ProjectReadmeSmartBlock[];
    commandTargetMaps: ReturnType<typeof buildProjectReadmeCommandTargetMaps>;
    report: ProjectReadmeRailReport;
    railTabs: ProjectReadmeRailTabId[];
    railActions: ProjectReadmeRailAction[];
    recommendedAction: ProjectReadmeRailAction | null;
    targetRegistry: Map<string, ProjectReadmeTargetRegistryEntry>;
    targetIds: string[];
    targetSignature: string;
};

const VIEW_MODEL_CACHE_LIMIT = 12;
const viewModelCache = new Map<string, ProjectReadmeViewModel>();

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
    storedHeadings?: ProjectReadmeHeading[];
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

function rememberViewModel(key: string, model: ProjectReadmeViewModel) {
    if (viewModelCache.has(key)) viewModelCache.delete(key);
    viewModelCache.set(key, model);
    while (viewModelCache.size > VIEW_MODEL_CACHE_LIMIT) {
        const oldestKey = viewModelCache.keys().next().value;
        if (!oldestKey) break;
        viewModelCache.delete(oldestKey);
    }
    return model;
}

function uniquePreviewBlocks(blocks: ProjectReadmeSmartBlock[]) {
    const seen = new Set<string>();
    const unique: ProjectReadmeSmartBlock[] = [];
    for (const block of blocks) {
        const key = `${block.kind}:${block.ids.join(",")}:${block.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(block);
    }
    return unique;
}

function buildRailTabs(input: {
    report: ProjectReadmeRailReport;
    commands: ProjectReadmeQuickCommand[];
    references: ProjectReadmeInlineReference[];
    headings: ProjectReadmeHeading[];
}) {
    const tabs: Array<{ id: ProjectReadmeRailTabId; score: number; order: number }> = [];
    const primaryCommands = input.commands.filter((command) => PROJECT_README_PRIMARY_COMMAND_GROUPS.has(command.group));
    const configCommands = input.commands.filter((command) => command.group === "config");
    const optionCommands = input.commands.filter((command) => command.group === "options");
    const setupCommands = primaryCommands.filter((command) => (
        command.group === "recommended"
        || command.group === "install"
        || command.group === "claude"
        || command.group === "agents"
    ));
    const hasBrief = Boolean(input.report.summary || input.report.summaryItems.length || input.report.signals.length || input.report.nextAction);
    const add = (id: ProjectReadmeRailTabId, score: number) => {
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

function commandRailTab(command: ProjectReadmeQuickCommand): ProjectReadmeRailTabId {
    if (command.group === "config") return "config";
    if (command.group === "options") return "options";
    return "commands";
}

function buildRailActions(input: {
    headings: ProjectReadmeHeading[];
    commands: ProjectReadmeQuickCommand[];
    references: ProjectReadmeInlineReference[];
}) {
    const commandActions: ProjectReadmeRailAction[] = input.commands.map((command, index) => ({
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

    const referenceActions: ProjectReadmeRailAction[] = input.references.map((reference, index) => ({
        id: `reference:${reference.kind}:${reference.id}:${index}`,
        kind: "reference",
        railTab: "links",
        label: normalizeReadmeReferenceLabel(reference.kind, reference.label),
        description: null,
        targetId: projectReadmeReferenceTargetId(reference.kind, reference.id, index),
        copyText: null,
        openHref: null,
        sourceIndex: index,
        reference,
        referencePreviewKey: `${reference.kind}:${reference.id}:${index}`,
        platforms: [],
    }));

    const headingActions: ProjectReadmeRailAction[] = input.headings.map((heading, index) => ({
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

function pickRecommendedAction(actions: ProjectReadmeRailAction[]) {
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
    headings: ProjectReadmeHeading[];
    commands: ProjectReadmeQuickCommand[];
    references: ProjectReadmeInlineReference[];
}) {
    const registry = new Map<string, ProjectReadmeTargetRegistryEntry>();
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
        const id = projectReadmeReferenceTargetId(reference.kind, reference.id, index);
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

export function buildProjectReadmeViewModel(input: {
    content: string;
    contentHash?: string | null;
    excerpt?: string | null;
    storedHeadings?: ProjectReadmeHeading[];
}): ProjectReadmeViewModel {
    const cacheKey = readmeViewModelCacheKey(input);
    const cached = viewModelCache.get(cacheKey);
    if (cached) return cached;

    const content = input.content;
    const headingsFromContent = extractProjectReadmeHeadings(content);
    const headings = headingsFromContent.length ? headingsFromContent : input.storedHeadings ?? [];
    const commands = extractProjectReadmeCommandShortcuts(content);
    const references = parseProjectReadmeInlineReferences(content);
    const segments = splitMarkdownBySmartBlocks(content);
    const smartBlocks = segments.flatMap((segment) => segment.kind === "block" ? [segment.block] : []);
    const referencePreviewBlocks = inlineReferencesToSmartBlocks(references);
    const previewBlocks = uniquePreviewBlocks([
        ...smartBlocks,
        ...referencePreviewBlocks,
    ]);
    const report = buildProjectReadmeRailReport({
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
        commandTargetMaps: buildProjectReadmeCommandTargetMaps(content),
        report,
        railTabs,
        railActions,
        recommendedAction,
        targetRegistry,
        targetIds,
        targetSignature: targetIds.join("|"),
    });
}
