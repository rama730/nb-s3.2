"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate, WidgetType } from "@codemirror/view";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, Github, Keyboard, Link, Loader2, Monitor, Save, Send, ShieldAlert, Smartphone, Tablet, X } from "lucide-react";
import { ProjectReadmeQualityPanel } from "./ProjectReadmeQualityPanel";
import { ProjectReadmeConflictResolver } from "./ProjectReadmeConflictResolver";
import { evaluateProjectReadmeQuality } from "@/lib/projects/readme-quality";

import { registerReadmeContributorAction } from "@/app/actions/project/readme";
import { ProjectReadmeMoreMenu, type ProjectReadmeMorePanel, PROJECT_README_INSERT_ACTIONS } from "@/components/projects/readme/ProjectReadmeMoreMenu";

import { useReadmeCollaboration } from "@/components/projects/readme/useReadmeCollaboration";
import type { ProjectReadmeDraftPayload } from "@/lib/projects/readme";
import { extractProjectReadmeHeadings, type ProjectReadmeHeading } from "@/lib/projects/readme";
import {
    normalizeReadmeReferenceLabel,
    unescapeReadmeReferenceLabel,
    type ProjectReadmeReferenceKind,
} from "@/lib/projects/readme-blocks";
import {
    useProjectReadmeDraftEditor,
    type ProjectReadmeEditorSaveResult,
} from "@/components/projects/readme/useProjectReadmeDraftEditor";
import {
    useProjectReadmeEditorStore,
    type LiveReviewSize,
    type CursorRange,
    type PreviewRevealTarget,
    type SourceHighlightTarget,
} from "@/components/projects/readme/useProjectReadmeEditorStore";
import type { Project } from "@/types/hub";
import {
    buildProjectReadmeEditorSourceTargets,
    findProjectReadmeEditorSourceTarget,
    getReadmeLineStartOffset,
    type ProjectReadmeEditorSourcePosition,
} from "@/lib/projects/readme-editor-source-map";
import { uploadProjectReadmeAsset } from "@/lib/projects/readme-upload-util";
import { cn } from "@/lib/utils";
import { useCompletion } from '@ai-sdk/react';
import type * as Y from "yjs";
import { useProjectReadmeVersions } from "@/hooks/hub/useProjectReadmeData";

const EditorSkeleton = () => <div className="h-full min-h-[500px] w-full animate-pulse bg-zinc-100 dark:bg-zinc-900 rounded-xl" />;
const PanelSkeleton = () => <div className="h-64 w-full animate-pulse bg-zinc-100 dark:bg-zinc-900 rounded-xl" />;

const CodeEditor = dynamic(() => import("@/components/projects/v2/editor/CodeEditor"), { ssr: false, loading: EditorSkeleton });
const ProjectReadmeWysiwygEditor = dynamic(() => import("@/components/projects/readme/ProjectReadmeWysiwygEditor").then(mod => ({ default: mod.ProjectReadmeWysiwygEditor })), { ssr: false, loading: EditorSkeleton });
const ProjectReadmeAssetManager = dynamic(() => import("@/components/projects/readme/ProjectReadmeAssetManager").then(mod => ({ default: mod.ProjectReadmeAssetManager })), { ssr: false, loading: PanelSkeleton });
const ProjectReadmeCalloutBuilder = dynamic(() => import("@/components/projects/readme/ProjectReadmeCalloutBuilder").then(mod => ({ default: mod.ProjectReadmeCalloutBuilder })), { ssr: false, loading: PanelSkeleton });
const ProjectReadmeCommandBuilder = dynamic(() => import("@/components/projects/readme/ProjectReadmeCommandBuilder").then(mod => ({ default: mod.ProjectReadmeCommandBuilder })), { ssr: false, loading: PanelSkeleton });
const ProjectReadmeHistory = dynamic(() => import("@/components/projects/readme/ProjectReadmeHistory").then(mod => ({ default: mod.ProjectReadmeHistory })), { ssr: false, loading: PanelSkeleton });
const ProjectReadmePublishModal = dynamic(() => import("@/components/projects/readme/ProjectReadmePublishModal").then(mod => ({ default: mod.ProjectReadmePublishModal })), { ssr: false, loading: () => null });
const ProjectReadmeInsertCommandCenter = dynamic(() => import("@/components/projects/readme/ProjectReadmeInsertCommandCenter").then(mod => ({ default: mod.ProjectReadmeInsertCommandCenter })), { ssr: false, loading: PanelSkeleton });
const ProjectReadmeLinkBuilder = dynamic(() => import("@/components/projects/readme/ProjectReadmeLinkBuilder").then(mod => ({ default: mod.ProjectReadmeLinkBuilder })), { ssr: false, loading: PanelSkeleton });
const ProjectReadmeReferencePicker = dynamic(() => import("@/components/projects/readme/ProjectReadmeReferencePicker").then(mod => ({ default: mod.ProjectReadmeReferencePicker })), { ssr: false, loading: PanelSkeleton });
const ProjectReadmeRenderer = dynamic(() => import("@/components/projects/readme/ProjectReadmeRenderer").then(mod => ({ default: mod.ProjectReadmeRenderer })), { ssr: false, loading: EditorSkeleton });
const ProjectReadmeStyleBuilder = dynamic(() => import("@/components/projects/readme/ProjectReadmeStyleBuilder").then(mod => ({ default: mod.ProjectReadmeStyleBuilder })), { ssr: false, loading: PanelSkeleton });
const ProjectReadmeTableBuilder = dynamic(() => import("@/components/projects/readme/ProjectReadmeTableBuilder").then(mod => ({ default: mod.ProjectReadmeTableBuilder })), { ssr: false, loading: PanelSkeleton });

type ReadmeHeadingTarget = ProjectReadmeHeading & { offset: number; line: number };

const README_EDIT_SELECTION_HIGHLIGHT_MS = 1400;
const README_LARGE_DOC_PREVIEW_DEBOUNCE_MS = 1200;
const README_LARGE_DOC_BYTES = 80 * 1024;
const README_QUALITY_DEBOUNCE_MS = 800;

const QUICK_INSERT_PANELS: ProjectReadmeMorePanel[] = ["style", "command", "reference", "assets", "table"];
const QUICK_INSERT_LABELS: Partial<Record<ProjectReadmeMorePanel, string>> = {
    style: "Style",
    command: "Cmd",
    reference: "Mention",
    assets: "Img",
    table: "Table",
};

const LIVE_REVIEW_SIZE_OPTIONS: Array<{
    id: LiveReviewSize;
    label: string;
    icon: typeof Monitor;
    className: string;
}> = [
    { id: "fluid", label: "Fluid", icon: Monitor, className: "max-w-none" },
    { id: "github", label: "GitHub", icon: Github, className: "max-w-[980px]" },
    { id: "tablet", label: "Tablet", icon: Tablet, className: "max-w-[720px]" },
    { id: "mobile", label: "Mobile", icon: Smartphone, className: "max-w-[390px]" },
];

const INLINE_REFERENCE_DECORATION_REGEX = /\{%\s*ref\.([a-z_]+)\s+id="([^"]+)"(?:\s+label="([^"]*)")?\s*%\}/gi;
const README_REFERENCE_KINDS = new Set<ProjectReadmeReferenceKind>(["roles", "contributors", "files", "tasks", "sprints"]);

function toReadmeReferenceKind(value: string | undefined): ProjectReadmeReferenceKind | null {
    if (!value) return null;
    return README_REFERENCE_KINDS.has(value as ProjectReadmeReferenceKind) ? value as ProjectReadmeReferenceKind : null;
}

class ReadmeReferenceWidget extends WidgetType {
    constructor(private readonly label: string) {
        super();
    }

    toDOM() {
        const node = document.createElement("span");
        node.className = "cm-readme-reference-chip";
        node.textContent = this.label;
        return node;
    }

    ignoreEvent() {
        return false;
    }
}

function buildReadmeReferenceDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    const seen = new Set<number>();
    for (const range of view.visibleRanges) {
        const scanFrom = Math.max(0, range.from - 256);
        const scanTo = Math.min(doc.length, range.to + 256);
        const text = doc.sliceString(scanFrom, scanTo);
        for (const match of text.matchAll(INLINE_REFERENCE_DECORATION_REGEX)) {
            if (typeof match.index !== "number") continue;
            const from = scanFrom + match.index;
            const to = from + match[0].length;
            if (to < range.from || from > range.to || seen.has(from)) continue;
            seen.add(from);
            const kind = toReadmeReferenceKind(match[1]);
            const label = kind
                ? normalizeReadmeReferenceLabel(kind, match[3] || "Reference")
                : unescapeReadmeReferenceLabel(match[3] || "Reference");
            builder.add(
                from,
                to,
                Decoration.replace({
                    widget: new ReadmeReferenceWidget(label),
                    inclusive: false,
                }),
            );
        }
    }
    return builder.finish();
}

function createReadmeReferenceDecorationExtension(): Extension[] {
    return [
        ViewPlugin.fromClass(class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildReadmeReferenceDecorations(view);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = buildReadmeReferenceDecorations(update.view);
                }
            }
        }, {
            decorations: (plugin) => plugin.decorations,
        }),
        EditorView.theme({
            ".cm-readme-reference-chip": {
                display: "inline-flex",
                alignItems: "center",
                color: "#93c5fd",
                fontSize: "12px",
                fontWeight: "700",
                lineHeight: "18px",
                padding: "0 2px",
                textDecoration: "underline",
                textDecorationColor: "rgba(147, 197, 253, 0.35)",
                textUnderlineOffset: "3px",
                verticalAlign: "middle",
            },
            /* Yjs Collaborative Caret & Selection */
            ".cm-ySelection": {
                backgroundColor: "rgba(59, 130, 246, 0.22)",
            },
            ".cm-ySelectionCaret": {
                position: "relative",
                borderLeft: "2px solid #3b82f6",
                marginLeft: "-1px",
                marginRight: "-1px",
                boxSizing: "border-box",
            },
            ".cm-ySelectionInfo": {
                opacity: 0,
                transition: "opacity .3s ease-in-out",
                position: "absolute",
                top: "-1.15em",
                left: "0",
                backgroundColor: "#3b82f6",
                fontFamily: "sans-serif",
                fontStyle: "normal",
                fontWeight: "600",
                lineHeight: "normal",
                userSelect: "none",
                color: "#fff",
                padding: "2px 4px",
                fontSize: "10px",
                borderRadius: "3px",
                zIndex: 101,
                pointerEvents: "none",
            },
            ".cm-ySelection-focused .cm-ySelectionInfo": {
                opacity: 1,
            },
        }),
    ];
}

function inferReferenceKindFromText(value: string): ProjectReadmeReferenceKind | null {
    const text = value.toLowerCase();
    if (/\b(tasks?|work|todo|issue|assignment)\b/.test(text)) return "tasks";
    if (/\b(sprints?|milestone|cycle)\b/.test(text)) return "sprints";
    if (/\b(files?|asset|image|document|screenshot|demo)\b/.test(text)) return "files";
    if (/\b(roles?|opening|position|need)\b/.test(text)) return "roles";
    if (/\b(contributors?|members?|people|collaborators?|owner|leader)\b/.test(text)) return "contributors";
    return null;
}

function suggestedPanelsForContext(content: string, cursorRange: CursorRange | null): ProjectReadmeMorePanel[] {
    const cursor = cursorRange ? Math.max(0, Math.min(cursorRange.selectionStart, content.length)) : content.length;
    const context = content.slice(Math.max(0, cursor - 180), cursor).toLowerCase();
    const suggestions: ProjectReadmeMorePanel[] = [];
    const add = (panel: ProjectReadmeMorePanel) => {
        if (!suggestions.includes(panel)) suggestions.push(panel);
    };

    if (inferReferenceKindFromText(context)) add("reference");
    if (/\b(style|template|structure|outline|readme|portfolio|docs|documentation|open source)\b/.test(context)) add("style");
    if (/\b(table|compare|comparison|before|after|metric|percent|percentage|roadmap|status)\b/.test(context)) add("table");
    if (/\b(command|install|run|terminal|bash|shell|npm|pnpm|yarn|docker|git)\b/.test(context)) add("command");
    if (/\b(image|screenshot|demo|gif|visual|photo|media)\b/.test(context)) add("assets");
    if (/\b(note|tip|important|warning|caution|remember)\b/.test(context)) add("callout");
    if (/\b(link|url|docs|website|guide|demo)\b/.test(context)) add("link");

    return suggestions;
}

function canOpenReadmeInsertFromSlash(view: EditorView) {
    const selection = view.state.selection.main;
    if (!selection.empty) return false;
    const beforeCursor = view.state.doc.sliceString(Math.max(0, selection.head - 1), selection.head);
    return selection.head === 0 || /\s/.test(beforeCursor);
}

function createReadmeSlashCommandExtension(onSlashCommand: (content: string, range: CursorRange) => void): Extension {
    return keymap.of([{
        key: "/",
        run: (view) => {
            if (!canOpenReadmeInsertFromSlash(view)) return false;
            const range = {
                selectionStart: view.state.selection.main.head,
                selectionEnd: view.state.selection.main.head,
            };
            onSlashCommand(view.state.doc.toString(), range);
            return true;
        },
    }]);
}

const QUALITY_ISSUE_SECTION_PATTERNS: Record<string, RegExp> = {
    "missing-overview": /\b(overview|about|introduction|summary)\b/i,
    "missing-setup": /\b(getting started|setup|installation|install|quick start)\b/i,
    "missing-usage": /\b(usage|how to use|run|demo|examples?)\b/i,
    "missing-demo": /\b(demo|screenshots?|preview|gallery)\b/i,
    "missing-contributing": /\b(contributing|contribution|collaboration|how to contribute)\b/i,
    "missing-command": /\b(getting started|setup|installation|install|run|commands?)\b/i,
};

function extractReadmeHeadingTargets(content: string): ReadmeHeadingTarget[] {
    const headings = extractProjectReadmeHeadings(content);
    if (!headings.length) return [];

    let headingIndex = 0;
    let offset = 0;
    let inFence = false;
    const targets: ReadmeHeadingTarget[] = [];
    const lines = content.split("\n");

    lines.forEach((line, index) => {
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            offset += line.length + 1;
            return;
        }

        if (!inFence && /^(#{1,4})\s+(.+?)\s*#*\s*$/.test(line.trim())) {
            const heading = headings[headingIndex];
            if (heading) {
                targets.push({ ...heading, offset, line: index + 1 });
                headingIndex += 1;
            }
        }

        offset += line.length + 1;
    });

    return targets;
}

function findLikelyIssueOffset(content: string, targets: ReadmeHeadingTarget[], issueId: string) {
    if (issueId.startsWith("image-") || issueId === "external-image") {
        const imageMatch = content.match(/!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>/i);
        if (imageMatch?.index != null) return imageMatch.index;
    }

    const pattern = QUALITY_ISSUE_SECTION_PATTERNS[issueId];
    if (pattern) {
        const existing = targets.find((target) => pattern.test(target.text));
        if (existing) return existing.offset;
    }

    if (issueId === "missing-overview") return 0;
    const trimmed = content.trimEnd();
    return trimmed.length ? trimmed.length + (content.endsWith("\n") ? 0 : 1) : 0;
}

function shouldGatePublish(issueId: string, severity: "info" | "warning" | "error") {
    return severity === "error"
        || issueId === "external-image"
        || issueId === "image-missing-alt"
        || issueId === "image-oversized"
        || issueId === "unsafe-url";
}

function formatSavedAt(value: number | null, now: number) {
    if (!value) return "Saved";
    const seconds = Math.max(0, Math.round((now - value) / 1000));
    if (seconds < 5) return "Saved now";
    if (seconds < 60) return `Saved ${seconds}s ago`;
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `Saved ${minutes}m ago`;
}

function cssIdSelector(id: string) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return `#${CSS.escape(id)}`;
    return `#${id.replace(/["\\#.:,[\]=]/g, "\\$&")}`;
}

function readmeEditorSourceSelector(targetId: string) {
    const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(targetId)
        : targetId.replace(/["\\#.:,[\]=]/g, "\\$&");
    return `${cssIdSelector(targetId)}, [data-readme-editor-target-id="${escaped}"]`;
}

function syncYTextContent(ydoc: Y.Doc, ytext: Y.Text, nextContent: string, origin: string) {
    const current = ytext.toString();
    if (current === nextContent) return;

    let prefix = 0;
    const maxPrefix = Math.min(current.length, nextContent.length);
    while (prefix < maxPrefix && current.charCodeAt(prefix) === nextContent.charCodeAt(prefix)) {
        prefix += 1;
    }

    let suffix = 0;
    const maxSuffix = Math.min(current.length - prefix, nextContent.length - prefix);
    while (
        suffix < maxSuffix
        && current.charCodeAt(current.length - 1 - suffix) === nextContent.charCodeAt(nextContent.length - 1 - suffix)
    ) {
        suffix += 1;
    }

    const deleteCount = current.length - prefix - suffix;
    const insertText = nextContent.slice(prefix, nextContent.length - suffix);
    ydoc.transact(() => {
        if (deleteCount > 0) ytext.delete(prefix, deleteCount);
        if (insertText) ytext.insert(prefix, insertText);
    }, origin);
}

export function ProjectReadmeEditor({
    project,
    draft,
    saving,
    publishing,
    currentUserName,
    onSave,
    onPublish,
    onRestore,
    onDeleteVersion,
    onSetCurrentVersion,
    onDiscardDraft,
    onExit,
}: {
    project: Project;
    draft: ProjectReadmeDraftPayload;
    saving: boolean;
    publishing: boolean;
    currentUserName?: string;
    onSave: (content: string, expectedDraftUpdatedAt: string | null) => Promise<ProjectReadmeEditorSaveResult | null>;
    onPublish: (content: string, expectedDraftUpdatedAt: string | null, changeSummary: string, syncToFilesTab: boolean) => Promise<boolean>;
    onRestore: (versionId: string) => Promise<ProjectReadmeEditorSaveResult | null>;
    onDeleteVersion: (versionId: string) => Promise<ProjectReadmeEditorSaveResult | null>;
    onSetCurrentVersion: (versionId: string) => Promise<ProjectReadmeEditorSaveResult | null>;
    onDiscardDraft: () => Promise<ProjectReadmeEditorSaveResult | null>;
    onExit: () => void;
}) {
    const activePanel = useProjectReadmeEditorStore((s) => s.activePanel);
    const setActivePanel = useProjectReadmeEditorStore((s) => s.setActivePanel);
    const moreOpen = useProjectReadmeEditorStore((s) => s.moreOpen);
    const setMoreOpen = useProjectReadmeEditorStore((s) => s.setMoreOpen);
    const cursorRange = useProjectReadmeEditorStore((s) => s.cursorRange);
    const setCursorRange = useProjectReadmeEditorStore((s) => s.setCursorRange);
    const referenceKindHint = useProjectReadmeEditorStore((s) => s.referenceKindHint);
    const setReferenceKindHint = useProjectReadmeEditorStore((s) => s.setReferenceKindHint);
    const selectionTarget = useProjectReadmeEditorStore((s) => s.selectionTarget);
    const setSelectionTarget = useProjectReadmeEditorStore((s) => s.setSelectionTarget);
    const previewRevealTarget = useProjectReadmeEditorStore((s) => s.previewRevealTarget);
    const setPreviewRevealTarget = useProjectReadmeEditorStore((s) => s.setPreviewRevealTarget);
    const sourceHighlightTarget = useProjectReadmeEditorStore((s) => s.sourceHighlightTarget);
    const setSourceHighlightTarget = useProjectReadmeEditorStore((s) => s.setSourceHighlightTarget);
    const liveReviewSize = useProjectReadmeEditorStore((s) => s.liveReviewSize);
    const setLiveReviewSize = useProjectReadmeEditorStore((s) => s.setLiveReviewSize);
    const [followCursor, setFollowCursor] = useState(true);
    const editorMode = useProjectReadmeEditorStore((s) => s.editorMode);
    const setEditorMode = useProjectReadmeEditorStore((s) => s.setEditorMode);
    const [nowTick, setNowTick] = useState(0);
    const toolbarRef = useRef<HTMLDivElement | null>(null);


    const previewPaneRef = useRef<HTMLDivElement | null>(null);
    const previewScrollFrameRef = useRef<number | null>(null);
    const previewHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sourceHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cursorActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cursorRevealTokenRef = useRef(0);
    const selectionTokenRef = useRef(0);
    const lastCursorSignatureRef = useRef<string | null>(null);
    const initialCursorActivityHandledRef = useRef(false);
    const initialEditorTargetHandledRef = useRef(false);
    const hasInitializedRef = useRef(false);

    const versionsQuery = useProjectReadmeVersions(project.id, activePanel === "history");

    // Yjs CRDT collaboration is configured and active during editing mode.
    const collaborationConfigured = Boolean(process.env.NEXT_PUBLIC_YJS_WEBSOCKET_URL?.trim());
    const collaborationEnabled = collaborationConfigured;
    const { ydoc, provider, status: yjsStatus, synced, roomFull } = useReadmeCollaboration(project.id, currentUserName, collaborationEnabled);
    const visualEditorAvailable = collaborationConfigured;
    const effectiveEditorMode = editorMode === "visual" && visualEditorAvailable ? "visual" : "code";

    useEffect(() => {
        if (provider && provider.awareness) {
            provider.awareness.setLocalStateField("editorMode", effectiveEditorMode);
        }
    }, [provider, effectiveEditorMode]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        let frameId = 0;

        const updateMetrics = () => {
            frameId = 0;
            const workspaceRoot = document.querySelector<HTMLElement>('[data-project-content-root="workspace"]');
            const routeRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
            const stickyTabs = document.querySelector<HTMLElement>("[data-project-sticky-tabs='true']");
            const toolbar = toolbarRef.current;

            if (!toolbar) return;

            // Measure top offset based on sticky tabs
            const toolbarTop = stickyTabs ? stickyTabs.getBoundingClientRect().bottom - (stickyTabs.parentElement?.getBoundingClientRect().top ?? 0) : 0;
            document.documentElement.style.setProperty("--readme-edit-toolbar-top", `${Math.max(0, toolbarTop)}px`);

            // Measure toolbar height
            const toolbarHeight = toolbar.getBoundingClientRect().height;
            document.documentElement.style.setProperty("--readme-edit-toolbar-height", `${toolbarHeight}px`);

            // Measure route height
            let routeHeight = window.innerHeight;
            if (workspaceRoot) {
                routeHeight = workspaceRoot.getBoundingClientRect().height;
            } else if (routeRoot) {
                routeHeight = routeRoot.getBoundingClientRect().height;
            }
            document.documentElement.style.setProperty("--readme-edit-route-height", `${routeHeight}px`);
        };

        const scheduleMetrics = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(updateMetrics);
        };

        const viewport = window.visualViewport;
        const resizeObserver = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(scheduleMetrics)
            : null;
        let workspaceRoot = document.querySelector<HTMLElement>('[data-project-content-root="workspace"]');
        const routeRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
        const stickyTabs = document.querySelector<HTMLElement>("[data-project-sticky-tabs='true']");
        [workspaceRoot, routeRoot, stickyTabs, toolbarRef.current]
            .filter((element): element is HTMLElement => Boolean(element))
            .forEach((element) => resizeObserver?.observe(element));

        let workspaceRecoveryObserver: MutationObserver | null = null;
        if (!workspaceRoot && typeof MutationObserver !== "undefined") {
            // MutationObserver is only a one-shot recovery path when edit mode flips
            // before the layout-owned workspace root is in the DOM.
            workspaceRecoveryObserver = new MutationObserver(() => {
                const nextWorkspaceRoot = document.querySelector<HTMLElement>('[data-project-content-root="workspace"]');
                if (!nextWorkspaceRoot) return;
                workspaceRoot = nextWorkspaceRoot;
                resizeObserver?.observe(workspaceRoot);
                scheduleMetrics();
                workspaceRecoveryObserver?.disconnect();
                workspaceRecoveryObserver = null;
            });
            workspaceRecoveryObserver.observe(document.body, { childList: true, subtree: true });
        }

        if (viewport) {
            viewport.addEventListener("resize", scheduleMetrics);
        }

        window.addEventListener("resize", scheduleMetrics);
        scheduleMetrics();

        return () => {
            workspaceRecoveryObserver?.disconnect();
            resizeObserver?.disconnect();
            if (viewport) {
                viewport.removeEventListener("resize", scheduleMetrics);
            }
            window.removeEventListener("resize", scheduleMetrics);
            if (frameId) window.cancelAnimationFrame(frameId);
        };
    }, [effectiveEditorMode]);

    const {
        content,
        setContent,
        contentRef,
        expectedDraftUpdatedAt,
        setExpectedDraftUpdatedAt,
        localNotice,
        setLocalNotice,
        conflict,
        saveState,
        lastSavedAt,
        isPending,
        saveNow,
        applyDraftResult,
        useLatestDraft,
        keepLocalDraft,
        applyMergedContent,
        acknowledgePublished,
        clearLocalBackup,
        dirty,
    } = useProjectReadmeDraftEditor({
        projectId: project.id,
        initialContent: draft.draftContent || "",
        initialDraftUpdatedAt: draft.draftUpdatedAt,
        initialQualityReport: draft.qualityReport,
        onSave,
    });

    const focusEditorRange = useCallback((from: number, to = from) => {
        selectionTokenRef.current += 1;
        setSelectionTarget({
            from: Math.max(0, from),
            to: Math.max(0, to),
            token: selectionTokenRef.current,
        });
    }, [setSelectionTarget]);

    const highlightEditorRange = useCallback((from: number, to: number) => {
        selectionTokenRef.current += 1;
        const token = selectionTokenRef.current;
        setSourceHighlightTarget({
            from: Math.max(0, from),
            to: Math.max(0, to),
            token,
        });
        if (sourceHighlightTimerRef.current) clearTimeout(sourceHighlightTimerRef.current);
        sourceHighlightTimerRef.current = setTimeout(() => {
            setSourceHighlightTarget((current) => current?.token === token ? null : current);
        }, README_EDIT_SELECTION_HIGHLIGHT_MS);
    }, [setSourceHighlightTarget]);

    const handleQualityJumpToSection = useCallback((issueId: string) => {
        const targets = extractReadmeHeadingTargets(content);
        const offset = findLikelyIssueOffset(content, targets, issueId);
        const matchingTarget = targets.find((target) => {
            const pattern = QUALITY_ISSUE_SECTION_PATTERNS[issueId];
            return pattern && pattern.test(target.text);
        });

        if (matchingTarget) {
            cursorRevealTokenRef.current += 1;
            setPreviewRevealTarget({ targetId: matchingTarget.id, token: cursorRevealTokenRef.current });
        }

        focusEditorRange(offset, offset);
        highlightEditorRange(offset, offset + 10);
    }, [content, focusEditorRange, highlightEditorRange, setPreviewRevealTarget]);

    const updateDocumentContent = useCallback((nextContent: string) => {
        if (provider) {
            const ytext = ydoc.getText('markdown');
            syncYTextContent(ydoc, ytext, nextContent, 'local-system-sync');
        } else {
            setContent(nextContent);
        }
    }, [ydoc, provider, setContent]);

    const handleVisualContentChange = useCallback((nextMarkdown: string) => {
        setContent(nextMarkdown);
        if (provider) {
            const ytext = ydoc.getText('markdown');
            syncYTextContent(ydoc, ytext, nextMarkdown, 'local-visual-sync');
        }
    }, [ydoc, provider, setContent]);

    useEffect(() => {
        if (!synced || !provider) return;
        const metaMap = ydoc.getMap('metadata');

        const observer = () => {
            const serverUpdatedAt = metaMap.get('draftUpdatedAt') as string | undefined;
            if (serverUpdatedAt) {
                setExpectedDraftUpdatedAt((current) => {
                    if (serverUpdatedAt !== current) {
                        return serverUpdatedAt;
                    }
                    return current;
                });
            }
        };
        metaMap.observe(observer);

        const initialVal = metaMap.get('draftUpdatedAt') as string | undefined;
        if (initialVal) {
            setExpectedDraftUpdatedAt((current) => {
                if (initialVal !== current) {
                    return initialVal;
                }
                return current;
            });
        }

        return () => metaMap.unobserve(observer);
    }, [ydoc, synced, provider, setExpectedDraftUpdatedAt]);

    useEffect(() => {
        if (!synced || !provider || !expectedDraftUpdatedAt) return;
        const metaMap = ydoc.getMap('metadata');
        const currentMeta = metaMap.get('draftUpdatedAt') as string | undefined;
        if (expectedDraftUpdatedAt !== currentMeta) {
            ydoc.transact(() => {
                metaMap.set('draftUpdatedAt', expectedDraftUpdatedAt);
                const ytext = ydoc.getText('markdown');
                syncYTextContent(ydoc, ytext, contentRef.current, 'local-metadata-update');
            }, 'local-metadata-update');
        }
    }, [ydoc, synced, provider, expectedDraftUpdatedAt, contentRef]);

    useEffect(() => {
        if (!collaborationEnabled) return;
        const ytext = ydoc.getText('markdown');
        // Only initialize if the network has synced and the document is genuinely empty.
        // Doing this before sync causes massive duplication when multiple users join.
        if (synced && !hasInitializedRef.current) {
            hasInitializedRef.current = true;
            const ytextContent = ytext.toString();
            if (ytextContent === "") {
                setTimeout(() => {
                    const currentText = ydoc.getText('markdown').toString();
                    if (currentText === "") {
                        const systemMap = ydoc.getMap('system');
                        if (!systemMap.has('initialized')) {
                            ydoc.transact(() => {
                                systemMap.set('initialized', true);
                                ydoc.getText('markdown').insert(0, contentRef.current);
                            }, 'local-init');
                        }
                    }
                }, 500 + Math.random() * 2000);
            } else if (ytextContent !== contentRef.current) {
                setContent(ytextContent, { isRemote: true });
            }
        }
        const observer = (event: any, transaction: any) => {
            const isLocal = transaction?.local ?? true;
            setContent(ytext.toString(), { isKeystroke: isLocal, isRemote: !isLocal });
        };
        ytext.observe(observer);
        return () => ytext.unobserve(observer);
    }, [collaborationEnabled, contentRef, ydoc, setContent, synced, provider]);

    const handleSetEditorMode = useCallback((mode: "code" | "visual") => {
        setEditorMode(mode);
        setLocalNotice(`Switched to ${mode} mode.`);
    }, [setEditorMode, setLocalNotice]);

    const deferredContent = useDeferredValue(content);
    const [previewContent, setPreviewContent] = useState(deferredContent);
    useEffect(() => {
        const delay = deferredContent.length > README_LARGE_DOC_BYTES ? README_LARGE_DOC_PREVIEW_DEBOUNCE_MS : 0;
        const timer = window.setTimeout(() => {
            setPreviewContent(deferredContent);
        }, delay);
        return () => window.clearTimeout(timer);
    }, [deferredContent]);

    const [qualityContent, setQualityContent] = useState(content);
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setQualityContent(deferredContent);
        }, README_QUALITY_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [deferredContent]);

    const qualityReport = useMemo(() => {
        return evaluateProjectReadmeQuality(qualityContent);
    }, [qualityContent]);

    // Register contributor telemetry
    useEffect(() => {
        // Do not register on initial load, only on actual edits after sync
        if (!synced || !dirty) return;
        const timer = window.setTimeout(() => {
            registerReadmeContributorAction(project.id).catch(() => {});
        }, 5000); // 5s debounce for registering
        return () => window.clearTimeout(timer);
    }, [deferredContent, project.id, synced, dirty]);

    const referenceDecorations = useMemo(() => createReadmeReferenceDecorationExtension(), []);
    const emptyPreviewByKey = useMemo(() => new Map(), []);
    const headingTargets = useMemo(() => extractReadmeHeadingTargets(content), [content]);
    const previewSourceTargets = useMemo(() => buildProjectReadmeEditorSourceTargets(content), [content]);
    const activePreviewTargetId = previewRevealTarget?.targetId ?? null;
    const deferredCursorRange = useDeferredValue(cursorRange);
    const contextSuggestedPanels = useMemo(
        () => suggestedPanelsForContext(deferredContent, deferredCursorRange),
        [deferredContent, deferredCursorRange],
    );
    const selectedMarkdown = useMemo(() => {
        if (!cursorRange || cursorRange.selectionStart === cursorRange.selectionEnd) return "";
        const start = Math.max(0, Math.min(cursorRange.selectionStart, content.length));
        const end = Math.max(start, Math.min(cursorRange.selectionEnd, content.length));
        return content.slice(start, end);
    }, [content, cursorRange]);
    const quickInsertActions = useMemo(() => (
        QUICK_INSERT_PANELS
            .map((panel) => PROJECT_README_INSERT_ACTIONS.find((action) => action.id === panel))
            .filter((action): action is (typeof PROJECT_README_INSERT_ACTIONS)[number] => Boolean(action))
    ), []);

    const handleCursorActivity = useCallback((position: { selectionStart: number; selectionEnd: number }) => {
        if (cursorActivityTimerRef.current) clearTimeout(cursorActivityTimerRef.current);
        cursorActivityTimerRef.current = setTimeout(() => {
            const signature = `${position.selectionStart}:${position.selectionEnd}`;
            setCursorRange((current) => {
                if (
                    current?.selectionStart === position.selectionStart
                    && current.selectionEnd === position.selectionEnd
                ) {
                    return current;
                }
                return {
                    selectionStart: position.selectionStart,
                    selectionEnd: position.selectionEnd,
                };
            });

            if (lastCursorSignatureRef.current === signature) return;
            lastCursorSignatureRef.current = signature;

            if (!initialCursorActivityHandledRef.current) {
                initialCursorActivityHandledRef.current = true;
                return;
            }

            if (!followCursor) return;
            const target = findProjectReadmeEditorSourceTarget(previewSourceTargets, position.selectionStart);
            if (!target) return;
            cursorRevealTokenRef.current += 1;
            setPreviewRevealTarget({ targetId: target.id, token: cursorRevealTokenRef.current });
        }, 150);
    }, [followCursor, previewSourceTargets, setCursorRange, setPreviewRevealTarget]);

    const openInsertPanel = useCallback((panel: ProjectReadmeMorePanel) => {
        setMoreOpen(true);
        setLocalNotice(null);

        if (panel === "reference") {
            setReferenceKindHint(inferReferenceKindFromText(content.slice(Math.max(0, (cursorRange?.selectionStart ?? content.length) - 180), cursorRange?.selectionStart ?? content.length)));
        } else {
            setReferenceKindHint(null);
        }

        setActivePanel(panel);
    }, [content, cursorRange, setActivePanel, setLocalNotice, setMoreOpen, setReferenceKindHint]);

    const defaultInsertPanel = useMemo<ProjectReadmeMorePanel>(
        () => contextSuggestedPanels[0] ?? "reference",
        [contextSuggestedPanels],
    );

    const handleInsertOpenChange = useCallback((open: boolean) => {
        setMoreOpen(open);
        if (open) {
            setActivePanel((current) => current ?? defaultInsertPanel);
            setLocalNotice(null);
            return;
        }
        setActivePanel(null);
        setReferenceKindHint(null);
    }, [defaultInsertPanel, setActivePanel, setLocalNotice, setMoreOpen, setReferenceKindHint]);

    const handleSlashCommand = useCallback((docContent: string, range: CursorRange) => {
        const suggestedPanel = suggestedPanelsForContext(docContent, range)[0] ?? "reference";
        const context = docContent.slice(Math.max(0, range.selectionStart - 180), range.selectionStart);
        setCursorRange(range);
        setMoreOpen(true);
        setLocalNotice(null);
        setActivePanel(suggestedPanel);
        setReferenceKindHint(suggestedPanel === "reference" ? inferReferenceKindFromText(context) : null);
    }, [setActivePanel, setCursorRange, setLocalNotice, setMoreOpen, setReferenceKindHint]);

    const slashCommandExtension = useMemo(
        () => createReadmeSlashCommandExtension(handleSlashCommand),
        [handleSlashCommand],
    );

    const { complete, completion, isLoading: isCompletionLoading } = useCompletion({
        api: '/api/completion',
        onFinish: (prompt, completion) => {
            insertAtCursor(completion);
            setLocalNotice("AI Autocomplete finished.");
        },
        onError: (err) => {
            setLocalNotice("AI Autocomplete failed.");
        }
    });

    const triggerCompletion = useCallback(() => {
        setLocalNotice("AI Autocomplete thinking...");
        const current = content;
        const start = cursorRange ? Math.max(0, Math.min(cursorRange.selectionStart, current.length)) : current.length;
        const context = current.slice(Math.max(0, start - 1500), start);
        complete(context);
    }, [complete, content, cursorRange, setLocalNotice]);

    const editorExtensions = useMemo(
        () => {
            const exts: Extension[] = [
                ...referenceDecorations, 
                slashCommandExtension,
                keymap.of([{
                    key: "Mod-Space",
                    run: () => {
                        triggerCompletion();
                        return true;
                    }
                }])
            ];
            return exts;
        },
        [referenceDecorations, slashCommandExtension, triggerCompletion],
    );

    const handlePreviewSourcePosition = useCallback((position: ProjectReadmeEditorSourcePosition) => {
        const offset = typeof position.offset === "number" && Number.isFinite(position.offset)
            ? Math.max(0, Math.min(position.offset, content.length))
            : getReadmeLineStartOffset(content, position.line ?? null);
        const target = position.targetId
            ? previewSourceTargets.find((item) => item.id === position.targetId) ?? findProjectReadmeEditorSourceTarget(previewSourceTargets, offset)
            : findProjectReadmeEditorSourceTarget(previewSourceTargets, offset);
        const targetId = position.targetId || target?.id;
        const editorOffset = target ? Math.max(target.startOffset, Math.min(offset, target.endOffset)) : offset;

        if (targetId) {
            cursorRevealTokenRef.current += 1;
            setPreviewRevealTarget({ targetId, token: cursorRevealTokenRef.current });
        }

        if (target) {
            highlightEditorRange(target.startOffset, target.endOffset);
        }

        const shouldSelectSourceRange = target?.kind === "image";
        const nextRange = shouldSelectSourceRange
            ? { selectionStart: target.startOffset, selectionEnd: target.endOffset }
            : { selectionStart: editorOffset, selectionEnd: editorOffset };
        setCursorRange(nextRange);
        focusEditorRange(nextRange.selectionStart, nextRange.selectionEnd);
        setLocalNotice(shouldSelectSourceRange ? "Selected image source" : "Moved editor to preview selection");
    }, [content, focusEditorRange, highlightEditorRange, previewSourceTargets, setCursorRange, setLocalNotice, setPreviewRevealTarget]);

    const insertAtCursor = useCallback((value: string) => {
        const current = collaborationEnabled && provider ? ydoc.getText('markdown').toString() : contentRef.current;
        const start = cursorRange ? Math.max(0, Math.min(cursorRange.selectionStart, current.length)) : current.length;
        const end = cursorRange ? Math.max(start, Math.min(cursorRange.selectionEnd, current.length)) : current.length;
        const needsLeadingBreak = start > 0 && value.startsWith("\n") && current[start - 1] === "\n";
        const insertValue = needsLeadingBreak ? value.replace(/^\n+/, "") : value;
        const next = `${current.slice(0, start)}${insertValue}${current.slice(end)}`;
        const nextCursor = start + insertValue.length;

        updateDocumentContent(next);
        setCursorRange({ selectionStart: nextCursor, selectionEnd: nextCursor });
        setActivePanel(null);
        setMoreOpen(false);
        focusEditorRange(nextCursor);
    }, [collaborationEnabled, ydoc, provider, contentRef, cursorRange, focusEditorRange, setActivePanel, updateDocumentContent, setCursorRange, setMoreOpen]);

    const handleManualSave = useCallback(async () => {
        await saveNow("Draft saved");
    }, [saveNow]);

    const performPublish = useCallback(async (changeSummary: string, syncToFilesTab: boolean) => {
        const published = await onPublish(content, expectedDraftUpdatedAt, changeSummary, syncToFilesTab);
        if (published) {
            acknowledgePublished();
        }
        return published;
    }, [acknowledgePublished, content, expectedDraftUpdatedAt, onPublish]);

    const [publishModalOpen, setPublishModalOpen] = useState(false);
    const handlePublishClick = useCallback(() => {
        const gatedIssue = qualityReport.issues.find((issue) => shouldGatePublish(issue.id, issue.severity));
        if (gatedIssue) {
            setMoreOpen(true);
            setActivePanel("quality");
            setLocalNotice("Review README quality before publishing");
            return;
        }
        setPublishModalOpen(true);
    }, [qualityReport.issues, setActivePanel, setLocalNotice, setMoreOpen, setPublishModalOpen]);

    const handleRestore = useCallback(async (versionId: string) => {
        const restored = await onRestore(versionId);
        if (restored) {
            updateDocumentContent(restored.serverDraftContent ?? "");
            applyDraftResult(restored, "Version restored to draft");
        }
        setActivePanel(null);
    }, [applyDraftResult, onRestore, updateDocumentContent, setActivePanel]);

    const handleSetCurrentVersion = useCallback(async (versionId: string) => {
        if (!window.confirm("Set this version as the current published README? Your draft will switch to this content.")) return;
        const result = await onSetCurrentVersion(versionId);
        if (result) {
            updateDocumentContent(result.serverDraftContent ?? "");
            applyDraftResult(result, "Current version updated");
        }
        setActivePanel(null);
    }, [applyDraftResult, onSetCurrentVersion, updateDocumentContent, setActivePanel]);

    const handleDeleteVersion = useCallback(async (versionId: string) => {
        if (!window.confirm("Delete this README version from visible history? If it is current, the newest remaining version becomes current and the draft follows it.")) return;
        const result = await onDeleteVersion(versionId);
        if (result?.serverDraftContent != null) {
            updateDocumentContent(result.serverDraftContent);
            applyDraftResult(result, "Version deleted");
        } else {
            setLocalNotice("Version deleted");
        }
    }, [applyDraftResult, onDeleteVersion, updateDocumentContent, setLocalNotice]);

    const handleDiscardDraft = useCallback(async () => {
        if (!window.confirm("Discard the current README draft? Unpublished edits will be removed.")) return;
        const result = await onDiscardDraft();
        if (result) {
            updateDocumentContent(result.serverDraftContent ?? "");
            applyDraftResult(result, "Draft discarded");
        }
        setActivePanel(null);
    }, [applyDraftResult, onDiscardDraft, updateDocumentContent, setActivePanel]);

    const closePanel = useCallback(() => {
        setActivePanel(null);
        setMoreOpen(false);
        setReferenceKindHint(null);
    }, [setActivePanel, setMoreOpen, setReferenceKindHint]);

    const handleFileDrop = useCallback(async (files: File[]) => {
        setLocalNotice(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}...`);
        for (const file of files) {
            try {
                const markdown = await uploadProjectReadmeAsset({
                    projectId: project.id,
                    file,
                    altText: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim(),
                });
                insertAtCursor(markdown);
            } catch (err) {
                setLocalNotice(`Failed to upload ${file.name}`);
            }
        }
        setLocalNotice("Files inserted");
    }, [insertAtCursor, project.id, setLocalNotice]);

    const handleApplyMergedContent = useCallback((nextContent: string) => {
        updateDocumentContent(nextContent);
        applyMergedContent(nextContent);
        focusEditorRange(0);
    }, [applyMergedContent, focusEditorRange, updateDocumentContent]);

    useEffect(() => {
        if (!dirty && !conflict) return undefined;
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [conflict, dirty]);

    useEffect(() => () => {
        if (previewScrollFrameRef.current) window.cancelAnimationFrame(previewScrollFrameRef.current);
        if (previewHighlightTimerRef.current) clearTimeout(previewHighlightTimerRef.current);
        if (sourceHighlightTimerRef.current) clearTimeout(sourceHighlightTimerRef.current);
        if (cursorActivityTimerRef.current) clearTimeout(cursorActivityTimerRef.current);
    }, []);

    useEffect(() => {
        setNowTick(Date.now());
    }, [lastSavedAt, saveState]);

    useEffect(() => {
        if (initialEditorTargetHandledRef.current || !content.trim()) return;
        initialEditorTargetHandledRef.current = true;
        const rawHash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
        if (!rawHash) return;
        const hash = decodeURIComponent(rawHash);
        const heading = headingTargets.find((target) => target.id === hash);
        if (!heading) return;
        setCursorRange({ selectionStart: heading.offset, selectionEnd: heading.offset });
        focusEditorRange(heading.offset);
        cursorRevealTokenRef.current += 1;
        setPreviewRevealTarget({ targetId: heading.id, token: cursorRevealTokenRef.current });
        setLocalNotice("Opened README at selected section");
    }, [content, focusEditorRange, headingTargets, setLocalNotice]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            if ((event.metaKey || event.ctrlKey) && key === "k") {
                event.preventDefault();
                openInsertPanel(defaultInsertPanel);
                return;
            }

            if (event.key === "Escape" && moreOpen) {
                event.preventDefault();
                closePanel();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [closePanel, defaultInsertPanel, handleManualSave, moreOpen, openInsertPanel]);

    useEffect(() => {
        if (!previewRevealTarget || !previewPaneRef.current) return undefined;
        if (previewScrollFrameRef.current) window.cancelAnimationFrame(previewScrollFrameRef.current);
        let attempts = 0;
        const revealPreviewTarget = () => {
            const root = previewPaneRef.current;
            if (!root) return;
            const target = root.querySelector<HTMLElement>(readmeEditorSourceSelector(previewRevealTarget.targetId));
            if (!target) {
                if (attempts < 8) {
                    attempts += 1;
                    previewScrollFrameRef.current = window.requestAnimationFrame(revealPreviewTarget);
                }
                return;
            }
            const rootRect = root.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const readableTop = Math.max(24, (rootRect.height - Math.min(targetRect.height, rootRect.height * 0.7)) * 0.5);
            const nextTop = root.scrollTop + targetRect.top - rootRect.top - readableTop;
            root.scrollTo({ top: Math.max(0, nextTop), behavior: "auto" });
        };
        previewScrollFrameRef.current = window.requestAnimationFrame(revealPreviewTarget);
        if (previewHighlightTimerRef.current) clearTimeout(previewHighlightTimerRef.current);
        previewHighlightTimerRef.current = setTimeout(() => {
            setPreviewRevealTarget((current) => (
                current?.token === previewRevealTarget.token ? null : current
            ));
        }, README_EDIT_SELECTION_HIGHLIGHT_MS);
        return () => {
            if (previewScrollFrameRef.current) window.cancelAnimationFrame(previewScrollFrameRef.current);
            previewScrollFrameRef.current = null;
        };
    }, [previewRevealTarget]);

    const saveStatus = saveState === "saving" || saving || isPending
        ? { label: "Saving", className: "text-amber-600 dark:text-amber-300" }
        : saveState === "conflict"
            ? { label: "Conflict", className: "text-red-600 dark:text-red-300" }
            : saveState === "dirty"
                ? { label: "Unsaved", className: "text-blue-600 dark:text-blue-300" }
                : { label: formatSavedAt(lastSavedAt, nowTick), className: "text-emerald-600 dark:text-emerald-300" };

    const panelCopy = activePanel === "style"
        ? { title: "Choose style", description: "Start from a portable README structure that matches the project type." }
        : activePanel === "table"
        ? { title: "Insert table", description: "Build comparisons, metrics, roadmaps, and summaries as normal Markdown tables." }
        : activePanel === "command"
            ? { title: "Insert command", description: "Create a copyable command block without writing fenced-code syntax by hand." }
            : activePanel === "callout"
                ? { title: "Insert callout", description: "Add note, tip, important, warning, or caution blocks for readers." }
                : activePanel === "link"
                    ? { title: "Insert link", description: "Create clean Markdown links for docs, demos, and support resources." }
                    : activePanel === "reference"
                        ? { title: "Insert project mention", description: "Search exact project records and insert compact inline mentions." }
                        : activePanel === "assets"
                            ? { title: "Insert image", description: "Upload managed README media and place it at your cursor." }
                            : activePanel === "quality"
                                ? { title: "README quality", description: "Review missing guidance, media issues, unsafe links, and publish blockers." }
                                : activePanel === "history"
                                    ? { title: "Version history", description: "Restore, publish, delete versions, or discard the current draft." }
                                    : null;

    const overlay = (
        <>
            <div className={activePanel === "style" ? "block" : "hidden"}>
                <ProjectReadmeStyleBuilder projectName={project.title} onInsert={insertAtCursor} onClose={closePanel} />
            </div>
            <div className={activePanel === "table" ? "block" : "hidden"}>
                <ProjectReadmeTableBuilder onInsert={insertAtCursor} onClose={closePanel} />
            </div>
            {activePanel === "command" && (
                <div className="block">
                    <ProjectReadmeCommandBuilder selectedMarkdown={selectedMarkdown} onInsert={insertAtCursor} onClose={closePanel} />
                </div>
            )}
            {activePanel === "callout" && (
                <div className="block">
                    <ProjectReadmeCalloutBuilder onInsert={insertAtCursor} onClose={closePanel} />
                </div>
            )}
            {activePanel === "link" && (
                <div className="block">
                    <ProjectReadmeLinkBuilder onInsert={insertAtCursor} onClose={closePanel} />
                </div>
            )}
            {activePanel === "reference" && (
                <div className="block">
                    <ProjectReadmeReferencePicker projectId={project.id} initialKind={referenceKindHint ?? undefined} onInsert={insertAtCursor} onClose={closePanel} />
                </div>
            )}
            {activePanel === "assets" && (
                <div className="block">
                    <ProjectReadmeAssetManager projectId={project.id} projectVisibility={project.visibility} selectedMarkdown={selectedMarkdown} onInserted={(markdown) => {
                        insertAtCursor(markdown);
                        closePanel();
                    }} />
                </div>
            )}
            <div className={activePanel === "quality" ? "block" : "hidden"}>
                <ProjectReadmeQualityPanel
                    report={qualityReport}
                    onInsertFix={insertAtCursor}
                    onJumpToSection={handleQualityJumpToSection}
                />
            </div>
            <div className={activePanel === "history" ? "block" : "hidden"}>
                <ProjectReadmeHistory
                    versions={versionsQuery.data ?? []}
                    loading={versionsQuery.isLoading}
                    currentVersionId={draft.publishedVersion?.id ?? null}
                    draftContent={content}
                    onRestore={(versionId) => void handleRestore(versionId)}
                    onDelete={(versionId) => void handleDeleteVersion(versionId)}
                    onSetCurrent={(versionId) => void handleSetCurrentVersion(versionId)}
                    onDiscardDraft={() => void handleDiscardDraft()}
                />
            </div>
        </>
    );

    return (
        <div
            className="relative flex flex-1 w-full min-w-0 max-w-none flex-col bg-white dark:bg-zinc-950 min-h-[calc(var(--readme-edit-route-height)-var(--readme-edit-toolbar-top))] lg:h-[calc(var(--readme-edit-route-height)-var(--readme-edit-toolbar-top))] lg:min-h-0"
            data-readme-edit-workspace="true"
            data-readme-autosave-state={saveState}
            data-readme-fullscreen-edit="true"
            data-readme-fixed-overlay-safe="true"
            data-readme-bottom-cover-shell="true"
            data-readme-layout-owned-workspace="true"
            data-readme-route-height-measured="true"
        >
            <ProjectReadmeInsertCommandCenter
                open={moreOpen}
                activePanel={activePanel}
                panelTitle={panelCopy?.title ?? ""}
                panelDescription={panelCopy?.description ?? ""}
                onPanelChange={openInsertPanel}
                onClose={closePanel}
                projectName={project.title}
            >
                {overlay}
            </ProjectReadmeInsertCommandCenter>

            <ProjectReadmePublishModal
                projectId={project.id}
                open={publishModalOpen}
                onOpenChange={setPublishModalOpen}
                onPublish={performPublish}
                isPublishing={publishing}
                data-readme-publish-readiness-gate="true"
            />

            {conflict && (
                <ProjectReadmeConflictResolver
                    localContent={content}
                    serverContent={conflict.serverDraftContent}
                    onKeepLocal={keepLocalDraft}
                    onUseLatest={useLatestDraft}
                    onApplyMerged={applyMergedContent}
                />
            )}

            <div className="flex flex-1 min-h-0 min-w-0 flex-col bg-white dark:bg-zinc-950" data-readme-flat-edit-shell="true">
                <div
                    ref={toolbarRef}
                    className="z-30 flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 xl:px-6 sticky top-[var(--readme-edit-toolbar-top)]"
                    data-readme-toolbar-aligned-to-project-tabs="true"
                    data-readme-edit-sticky-toolbar="true"
                    data-readme-toolbar-height-measured="true"
                >
                    <div className="flex min-w-0 shrink-0 items-center gap-4">
                        <button
                            type="button"
                            onClick={onExit}
                            className="inline-flex h-8 items-center gap-2 rounded-full px-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            title="Go back"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            <span className="hidden sm:inline">Back</span>
                        </button>
                        <div className="hidden sm:block h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
                        <div className="flex items-center gap-3 min-w-0">
                            <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">README.md</p>
                            {draft.linkedNode && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-green-600/30 bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:border-green-500/20 dark:bg-green-500/20 dark:text-green-400">
                                    <Link className="h-3 w-3" />
                                    Powered by {draft.linkedNode.name}
                                </span>
                            )}
                            
                            {/* Unified Sleek Status Indicator */}
                            {(() => {
                                const unifiedStatus = (() => {
                                    if (roomFull) {
                                        return { label: "Room Full", color: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]", textColor: "text-rose-600 dark:text-rose-400" };
                                    }
                                    if (saveState === "conflict") {
                                        return { label: "Conflict", color: "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]", textColor: "text-rose-600 dark:text-rose-400" };
                                    }
                                    if (saveState === "saving" || saving || isPending) {
                                        return { label: "Saving...", color: "bg-amber-500 animate-pulse", textColor: "text-amber-600 dark:text-amber-400" };
                                    }
                                    if (saveState === "dirty") {
                                        return { label: "Unsaved", color: "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]", textColor: "text-blue-600 dark:text-blue-400" };
                                    }
                                    if (yjsStatus === "connected") {
                                        return { label: "Live", color: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]", textColor: "text-emerald-600 dark:text-emerald-400" };
                                    }
                                    if (yjsStatus === "connecting") {
                                        return { label: "Connecting...", color: "bg-amber-500 animate-pulse", textColor: "text-amber-600 dark:text-amber-400" };
                                    }
                                    if (yjsStatus === "disconnected") {
                                        return { label: "Disconnected", color: "bg-rose-500", textColor: "text-rose-600 dark:text-rose-400" };
                                    }
                                    return { label: formatSavedAt(lastSavedAt, nowTick), color: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]", textColor: "text-emerald-600 dark:text-emerald-400" };
                                })();

                                return (
                                    <div className="flex items-center gap-2 select-none border-l border-zinc-200 pl-3 dark:border-zinc-800">
                                        <span className={cn("h-1.5 w-1.5 rounded-full", unifiedStatus.color)} />
                                        <span className={cn("text-[11px] font-semibold uppercase tracking-wider", unifiedStatus.textColor)}>
                                            {unifiedStatus.label}
                                        </span>
                                    </div>
                                );
                            })()}

                            <button 
                                type="button" 
                                className="hidden md:inline-flex text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400 transition" 
                                title="Press Cmd/Ctrl+K to insert project mentions"
                            >
                                <Keyboard className="h-4 w-4" />
                            </button>

                            {localNotice ? (
                                <span className="hidden lg:inline max-w-52 truncate text-xs text-zinc-400" role="status" aria-live="polite">
                                    · {localNotice}
                                </span>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex min-w-0 items-center gap-4 overflow-x-auto lg:justify-center" data-readme-quick-insert-toolbar="true">
                        <div className="flex shrink-0 items-center gap-1.5 bg-zinc-100 p-0.5 rounded-lg dark:bg-zinc-900 mr-2">
                            <button
                                type="button"
                                onClick={() => handleSetEditorMode("code")}
                                className={cn(
                                    "px-3 py-1 rounded-md text-xs font-semibold transition-colors",
                                    effectiveEditorMode === "code" ? "bg-white shadow-sm text-blue-600 dark:bg-zinc-800 dark:text-blue-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                )}
                            >
                                Code
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSetEditorMode("visual")}
                                disabled={!visualEditorAvailable}
                                title={visualEditorAvailable ? "Visual editor" : "Visual editor requires README collaboration to be configured"}
                                className={cn(
                                    "px-3 py-1 rounded-md text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                                    effectiveEditorMode === "visual" ? "bg-white shadow-sm text-blue-600 dark:bg-zinc-800 dark:text-blue-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                )}
                            >
                                Visual
                            </button>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            {quickInsertActions.map((action) => {
                                const Icon = action.icon;
                                return (
                                    <button
                                        key={action.id}
                                        type="button"
                                        onClick={() => openInsertPanel(action.id)}
                                        className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                        title={action.label}
                                    >
                                        <Icon className="h-4 w-4" />
                                        {QUICK_INSERT_LABELS[action.id] ?? action.label}
                                    </button>
                                );
                            })}
                        </div>

                    </div>
                    <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-3 overflow-x-auto lg:justify-end" data-readme-editor-actions="true">
                        <button
                            type="button"
                            onClick={() => setFollowCursor(!followCursor)}
                            className={cn(
                                "inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-semibold border transition disabled:opacity-60",
                                followCursor
                                    ? "bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950/40 dark:border-blue-900/50 dark:text-blue-400"
                                    : "bg-white border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            )}
                            title="Toggle follow cursor"
                            aria-pressed={followCursor}
                        >
                            <Eye className="h-4 w-4" />
                            <span className="hidden md:inline">Follow</span>
                        </button>
                        <ProjectReadmeMoreMenu
                            open={moreOpen}
                            onOpenChange={handleInsertOpenChange}
                            onOpenPanel={openInsertPanel}
                        />
                        {saveState === "conflict" ? (
                            <button
                                type="button"
                                onClick={handleManualSave}
                                disabled={saving || isPending}
                                className="inline-flex h-9 items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-60 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                                title="Resolve conflict and save"
                            >
                                {saving || isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                <span className="hidden sm:inline">Save</span>
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={handlePublishClick}
                            disabled={publishing}
                            className="inline-flex h-9 min-w-[112px] shrink-0 items-center justify-center gap-2 rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                            title="Publish README"
                        >
                            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            <span>Publish</span>
                        </button>
                    </div>
                </div>

                {/* Collaboration Room Limit Alert Banner */}
                {roomFull && (
                    <div className="z-20 flex items-center justify-between gap-3 bg-rose-50 px-6 py-3 text-xs font-medium text-rose-700 border-b border-rose-100 dark:bg-rose-950/20 dark:text-rose-300 dark:border-rose-900/30 animate-in slide-in-from-top duration-300">
                        <div className="flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-500" />
                            <span>Room limit reached (max 5 editors). Syncing is currently paused. Please wait for someone to leave to resume editing collaboration.</span>
                        </div>
                    </div>
                )}



                <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-2" data-readme-split-editor="true" data-readme-equal-split="50-50" data-readme-parallel-sync="scroll-and-cursor-heading" data-readme-split-fills-remaining-viewport="true">
                    <section className="flex min-h-0 min-w-0 flex-col border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:border-b-0 lg:border-r" aria-label="README Markdown editor">
                        <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800" data-readme-write-pane-title="true">
                            <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Write</p>
                            <span className="text-xs text-zinc-500">Markdown</span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden" data-readme-editor-code-surface="true" data-readme-bottom-gap-guard="true">
                            {effectiveEditorMode === "visual" ? (
                                provider ? (
                                    <ProjectReadmeWysiwygEditor
                                        ydoc={ydoc}
                                        provider={provider}
                                        synced={synced}
                                        initialContent={content}
                                        currentUserName={currentUserName}
                                        onContentChange={handleVisualContentChange}
                                    />
                                ) : (
                                    <EditorSkeleton />
                                )
                            ) : (
                                <CodeEditor
                                    filename="README.md"
                                    value={content}
                                    onChange={(nextValue) => {
                                        if (!provider) {
                                            setContent(nextValue, { isKeystroke: true });
                                        }
                                    }}
                                    tabId="project-readme-editor"
                                    onCursorActivity={handleCursorActivity}
                                    extraExtensions={editorExtensions}
                                    selectionRange={selectionTarget}
                                    sourceHighlightRange={sourceHighlightTarget}
                                    onFileDrop={handleFileDrop}
                                    isCollaborative={Boolean(provider)}
                                    ydoc={ydoc}
                                    provider={provider}
                                />
                            )}
                        </div>
                    </section>

                    <aside className="flex min-h-0 min-w-0 flex-col bg-zinc-50/40 dark:bg-zinc-950" aria-label="README Live Review" data-readme-live-review-pane="true">
                        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
                            <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" data-readme-live-review-title="true">Live Review</p>
                            <div className="flex shrink-0 items-center gap-1 rounded-full border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900/70" data-readme-live-review-size-controls="true">
                                {LIVE_REVIEW_SIZE_OPTIONS.map((option) => {
                                    const Icon = option.icon;
                                    const active = option.id === liveReviewSize;
                                    return (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => setLiveReviewSize(option.id)}
                                            className={cn(
                                                "inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-blue-600 dark:text-zinc-400 dark:hover:bg-zinc-800",
                                                active && "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
                                            )}
                                            title={`${option.label} review size`}
                                            aria-pressed={active}
                                        >
                                            <Icon className="h-3.5 w-3.5" />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div
                            ref={previewPaneRef}
                            className="app-scroll app-scroll-y app-scroll-gutter min-h-0 flex-1 px-5 py-5 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-7"
                            data-readme-live-preview="true"
                            data-readme-live-review-size={liveReviewSize}
                            data-readme-large-document-mode={content.length > README_LARGE_DOC_BYTES ? "true" : undefined}
                            data-readme-bottom-gap-guard="true"
                        >
                            <div className={cn("mx-auto min-h-full w-full transition-[max-width]", LIVE_REVIEW_SIZE_OPTIONS.find((option) => option.id === liveReviewSize)?.className ?? "max-w-none")}>
                                <ProjectReadmeRenderer
                                    content={previewContent}
                                    project={project}
                                    allowExternalImages={draft.settings.externalImages}
                                    allowSmartBlocks={draft.settings.projectBlocks}
                                    editorMode
                                    fidelity={liveReviewSize === "github" ? "github" : "app"}
                                    highlightedTargetId={activePreviewTargetId}
                                    highlightedTargetToken={previewRevealTarget?.token ?? null}
                                    onRequestSourcePosition={handlePreviewSourcePosition}
                                    previewByKey={emptyPreviewByKey}
                                    previewsLoading={false}
                                />
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}
