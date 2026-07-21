"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate, WidgetType } from "@codemirror/view";
import dynamic from "next/dynamic";
import { ArrowLeft, Eye, Github, Keyboard, Link, Loader2, Monitor, Save, Send, ShieldAlert, Smartphone, Tablet } from "lucide-react";
import { ProjectDocQualityPanel } from "./ProjectDocQualityPanel";
import { ProjectDocConflictResolver } from "./ProjectDocConflictResolver";
import { evaluateProjectDocQuality } from "@/lib/projects/doc-quality";

import { registerReadmeContributorAction } from "@/app/actions/project/doc";
import { ProjectDocMoreMenu, type ProjectDocMorePanel, PROJECT_DOC_INSERT_ACTIONS } from "@/components/projects/doc/ProjectDocMoreMenu";

import { useDocCollaboration } from "@/components/projects/doc/useDocCollaboration";
import type { ProjectDocDraftPayload } from "@/lib/projects/doc";
import {
    extractProjectDocHeadings,
    resolveProjectDocCollaborationContent,
    normalizeProjectDocContent,
    normalizeProjectDocSlug,
    type ProjectDocHeading,
} from "@/lib/projects/doc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import CodeEditor from "@/components/projects/v2/editor/CodeEditor";
import { ProjectDocWysiwygEditor } from "@/components/projects/doc/ProjectDocWysiwygEditor";
import {
    normalizeReadmeReferenceLabel,
    unescapeReadmeReferenceLabel,
    type ProjectDocReferenceKind,
} from "@/lib/projects/doc-blocks";
import {
    useProjectDocDraftEditor,
    type ProjectDocEditorSaveResult,
} from "@/components/projects/doc/useProjectDocDraftEditor";
import {
    useProjectDocEditorStore,
    type LiveReviewSize,
    type CursorRange,
} from "@/components/projects/doc/useProjectDocEditorStore";
import type { Project } from "@/types/hub";
import {
    buildProjectDocEditorSourceTargets,
    findProjectDocEditorSourceTarget,
    getDocLineStartOffset,
    type ProjectDocEditorSourcePosition,
} from "@/lib/projects/doc-editor-source-map";
import { uploadProjectDocAsset } from "@/lib/projects/doc-upload-util";
import { cn } from "@/lib/utils";
import { useCompletion } from '@ai-sdk/react';
import type * as Y from "yjs";
import { useProjectDocVersions } from "@/hooks/hub/useProjectDocData";

const EditorSkeleton = () => <div className="h-full min-h-[500px] w-full animate-pulse bg-zinc-100 dark:bg-zinc-900 rounded-xl" />;
const PanelSkeleton = () => <div className="h-64 w-full animate-pulse bg-zinc-100 dark:bg-zinc-900 rounded-xl" />;

const ProjectDocAssetManager = dynamic(() => import("@/components/projects/doc/ProjectDocAssetManager").then(mod => ({ default: mod.ProjectDocAssetManager })), { ssr: false, loading: PanelSkeleton });
const ProjectDocCalloutBuilder = dynamic(() => import("@/components/projects/doc/ProjectDocCalloutBuilder").then(mod => ({ default: mod.ProjectDocCalloutBuilder })), { ssr: false, loading: PanelSkeleton });
const ProjectDocCommandBuilder = dynamic(() => import("@/components/projects/doc/ProjectDocCommandBuilder").then(mod => ({ default: mod.ProjectDocCommandBuilder })), { ssr: false, loading: PanelSkeleton });
const ProjectDocHistory = dynamic(() => import("@/components/projects/doc/ProjectDocHistory").then(mod => ({ default: mod.ProjectDocHistory })), { ssr: false, loading: PanelSkeleton });
const ProjectDocPublishModal = dynamic(() => import("@/components/projects/doc/ProjectDocPublishModal").then(mod => ({ default: mod.ProjectDocPublishModal })), { ssr: false, loading: () => null });
const ProjectDocInsertCommandCenter = dynamic(() => import("@/components/projects/doc/ProjectDocInsertCommandCenter").then(mod => ({ default: mod.ProjectDocInsertCommandCenter })), { ssr: false, loading: PanelSkeleton });
const ProjectDocLinkBuilder = dynamic(() => import("@/components/projects/doc/ProjectDocLinkBuilder").then(mod => ({ default: mod.ProjectDocLinkBuilder })), { ssr: false, loading: PanelSkeleton });
const ProjectDocReferencePicker = dynamic(() => import("@/components/projects/doc/ProjectDocReferencePicker").then(mod => ({ default: mod.ProjectDocReferencePicker })), { ssr: false, loading: PanelSkeleton });
const ProjectDocRenderer = dynamic(() => import("@/components/projects/doc/ProjectDocRenderer").then(mod => ({ default: mod.ProjectDocRenderer })), { ssr: false, loading: EditorSkeleton });
const ProjectDocStyleBuilder = dynamic(() => import("@/components/projects/doc/ProjectDocStyleBuilder").then(mod => ({ default: mod.ProjectDocStyleBuilder })), { ssr: false, loading: PanelSkeleton });
const ProjectDocTableBuilder = dynamic(() => import("@/components/projects/doc/ProjectDocTableBuilder").then(mod => ({ default: mod.ProjectDocTableBuilder })), { ssr: false, loading: PanelSkeleton });

type ReadmeHeadingTarget = ProjectDocHeading & { offset: number; line: number };

const README_EDIT_SELECTION_HIGHLIGHT_MS = 1400;
const README_LARGE_DOC_PREVIEW_DEBOUNCE_MS = 1200;
const README_LARGE_DOC_BYTES = 80 * 1024;
const README_QUALITY_DEBOUNCE_MS = 800;

const QUICK_INSERT_PANELS: ProjectDocMorePanel[] = ["style", "command", "reference", "assets", "table"];
const QUICK_INSERT_LABELS: Partial<Record<ProjectDocMorePanel, string>> = {
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
const README_REFERENCE_KINDS = new Set<ProjectDocReferenceKind>(["roles", "contributors", "files", "tasks", "sprints"]);

function toDocReferenceKind(value: string | undefined): ProjectDocReferenceKind | null {
    if (!value) return null;
    return README_REFERENCE_KINDS.has(value as ProjectDocReferenceKind) ? value as ProjectDocReferenceKind : null;
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
            const kind = toDocReferenceKind(match[1]);
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
            provide: (plugin) => EditorView.atomicRanges.of(view => {
                return view.plugin(plugin)?.decorations || Decoration.none;
            })
        }),
        keymap.of([
            {
                key: "Backspace",
                run: (view: EditorView): boolean => {
                    const ranges = view.state.selection.ranges;
                    if (ranges.length !== 1) return false;
                    const range = ranges[0];
                    if (!range || !range.empty) return false;

                    const pos = range.head;
                    const line = view.state.doc.lineAt(pos);
                    const lineText = line.text;

                    const regex = new RegExp(INLINE_REFERENCE_DECORATION_REGEX.source, INLINE_REFERENCE_DECORATION_REGEX.flags);
                    let match;
                    while ((match = regex.exec(lineText)) !== null) {
                        const matchStart = line.from + match.index;
                        const matchEnd = matchStart + match[0].length;
                        if (pos > matchStart && pos <= matchEnd) {
                            view.dispatch({
                                changes: { from: matchStart, to: matchEnd },
                                selection: { anchor: matchStart }
                            });
                            return true;
                        }
                    }
                    return false;
                }
            },
            {
                key: "Delete",
                run: (view: EditorView): boolean => {
                    const ranges = view.state.selection.ranges;
                    if (ranges.length !== 1) return false;
                    const range = ranges[0];
                    if (!range || !range.empty) return false;

                    const pos = range.head;
                    const line = view.state.doc.lineAt(pos);
                    const lineText = line.text;

                    const regex = new RegExp(INLINE_REFERENCE_DECORATION_REGEX.source, INLINE_REFERENCE_DECORATION_REGEX.flags);
                    let match;
                    while ((match = regex.exec(lineText)) !== null) {
                        const matchStart = line.from + match.index;
                        const matchEnd = matchStart + match[0].length;
                        if (pos >= matchStart && pos < matchEnd) {
                            view.dispatch({
                                changes: { from: matchStart, to: matchEnd },
                                selection: { anchor: matchStart }
                            });
                            return true;
                        }
                    }
                    return false;
                }
            }
        ]),
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

function inferReferenceKindFromText(value: string): ProjectDocReferenceKind | null {
    const text = value.toLowerCase();
    if (/\b(tasks?|work|todo|issue|assignment)\b/.test(text)) return "tasks";
    if (/\b(sprints?|milestone|cycle)\b/.test(text)) return "sprints";
    if (/\b(files?|asset|image|document|screenshot|demo)\b/.test(text)) return "files";
    if (/\b(roles?|opening|position|need)\b/.test(text)) return "roles";
    if (/\b(contributors?|members?|people|collaborators?|owner|leader)\b/.test(text)) return "contributors";
    return null;
}

function suggestedPanelsForContext(content: string, cursorRange: CursorRange | null): ProjectDocMorePanel[] {
    const cursor = cursorRange ? Math.max(0, Math.min(cursorRange.selectionStart, content.length)) : content.length;
    const context = content.slice(Math.max(0, cursor - 180), cursor).toLowerCase();
    const suggestions: ProjectDocMorePanel[] = [];
    const add = (panel: ProjectDocMorePanel) => {
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
    const headings = extractProjectDocHeadings(content);
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

export function ProjectDocEditor({
    project,
    draft,
    saving,
    publishing,
    currentUserId,
    currentUserName,
    docSlug = "readme",
    onSave,
    onPublish,
    onRestore,
    onDeleteVersion,
    onSetCurrentVersion,
    onDiscardDraft,
    onExit,
}: {
    project: Project;
    draft: ProjectDocDraftPayload;
    saving: boolean;
    publishing: boolean;
    currentUserId?: string | null;
    currentUserName?: string;
    docSlug?: string;
    onSave: (content: string, expectedDraftUpdatedAt: string | null) => Promise<ProjectDocEditorSaveResult | null>;
    onPublish: (content: string, expectedDraftUpdatedAt: string | null, changeSummary: string, syncToFilesTab: boolean) => Promise<boolean>;
    onRestore: (versionId: string) => Promise<ProjectDocEditorSaveResult | null>;
    onDeleteVersion: (versionId: string) => Promise<ProjectDocEditorSaveResult | null>;
    onSetCurrentVersion: (versionId: string) => Promise<ProjectDocEditorSaveResult | null>;
    onDiscardDraft: () => Promise<ProjectDocEditorSaveResult | null>;
    onExit: () => void;
}) {
    const activePanel = useProjectDocEditorStore((s) => s.activePanel);
    const setActivePanel = useProjectDocEditorStore((s) => s.setActivePanel);
    const moreOpen = useProjectDocEditorStore((s) => s.moreOpen);
    const setMoreOpen = useProjectDocEditorStore((s) => s.setMoreOpen);
    const cursorRange = useProjectDocEditorStore((s) => s.cursorRange);
    const setCursorRange = useProjectDocEditorStore((s) => s.setCursorRange);
    const referenceKindHint = useProjectDocEditorStore((s) => s.referenceKindHint);
    const setReferenceKindHint = useProjectDocEditorStore((s) => s.setReferenceKindHint);
    const selectionTarget = useProjectDocEditorStore((s) => s.selectionTarget);
    const setSelectionTarget = useProjectDocEditorStore((s) => s.setSelectionTarget);
    const previewRevealTarget = useProjectDocEditorStore((s) => s.previewRevealTarget);
    const setPreviewRevealTarget = useProjectDocEditorStore((s) => s.setPreviewRevealTarget);
    const sourceHighlightTarget = useProjectDocEditorStore((s) => s.sourceHighlightTarget);
    const setSourceHighlightTarget = useProjectDocEditorStore((s) => s.setSourceHighlightTarget);
    const liveReviewSize = useProjectDocEditorStore((s) => s.liveReviewSize);
    const setLiveReviewSize = useProjectDocEditorStore((s) => s.setLiveReviewSize);
    const [followCursor, setFollowCursor] = useState(true);
    const editorMode = useProjectDocEditorStore((s) => s.editorMode);
    const setEditorMode = useProjectDocEditorStore((s) => s.setEditorMode);
    const [nowTick, setNowTick] = useState(0);
    const toolbarRef = useRef<HTMLDivElement | null>(null);

    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [discarding, setDiscarding] = useState(false);
    const initialContentRef = useRef(normalizeProjectDocContent(draft.draftContent || ""));
    const normalizedDocSlug = useMemo(() => normalizeProjectDocSlug(docSlug), [docSlug]);


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

    const versionsQuery = useProjectDocVersions(project.id, normalizedDocSlug, activePanel === "history");

    // Yjs CRDT collaboration is configured and active during editing mode.
    const collaborationConfigured = Boolean(process.env.NEXT_PUBLIC_YJS_WEBSOCKET_URL?.trim());
    const collaborationEnabled = collaborationConfigured;
    const { ydoc, provider, status: yjsStatus, synced } = useDocCollaboration(project.id, normalizedDocSlug, currentUserId, currentUserName, collaborationEnabled);
    const [roomFull, setRoomFull] = useState(false);
    const [pendingPromotionActive, setPendingPromotionActive] = useState(false);
    const [promotionCountdown, setPromotionCountdown] = useState(10);

    useEffect(() => {
        if (!provider || !currentUserId) return;
        const collabState = ydoc.getMap('collaborationState');
        const observer = () => {
            const activeEditors = (collabState.get('activeEditors') as any[]) || [];
            const isActive = activeEditors.some((e: any) => e.userId === currentUserId);
            
            if (activeEditors.length > 0) {
                setRoomFull(!isActive);
            } else {
                setRoomFull(false);
            }

            const pending = collabState.get('pendingPromotion') as { userId: string; promotedAt: number } | null;
            if (pending && pending.userId === currentUserId) {
                setPendingPromotionActive(true);
                const elapsed = Math.floor((Date.now() - pending.promotedAt) / 1000);
                setPromotionCountdown(Math.max(0, 10 - elapsed));
            } else {
                setPendingPromotionActive(false);
            }

            if (isActive && provider.awareness) {
                provider.awareness.setLocalStateField('acceptPromotion', null);
            }
        };
        collabState.observe(observer);
        observer();
        return () => collabState.unobserve(observer);
    }, [provider, ydoc, currentUserId]);

    useEffect(() => {
        if (!pendingPromotionActive) return;
        const interval = setInterval(() => {
            setPromotionCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [pendingPromotionActive]);

    const handleAcceptPromotion = useCallback(() => {
        if (provider && provider.awareness) {
            provider.awareness.setLocalStateField('acceptPromotion', true);
            setPendingPromotionActive(false);
        }
    }, [provider]);

    const visualEditorAvailable = collaborationConfigured;
    const effectiveEditorMode = editorMode === "visual" && visualEditorAvailable ? "visual" : "code";

    useEffect(() => {
        if (provider && provider.awareness) {
            provider.awareness.setLocalStateField("editorMode", effectiveEditorMode);
        }
    }, [provider, effectiveEditorMode]);

    useEffect(() => {
        if (!provider || !provider.awareness) return;

        const handleActivity = () => {
            if (provider.awareness) {
                provider.awareness.setLocalStateField("lastActiveAt", Date.now());
            }
        };

        handleActivity();

        window.addEventListener("keydown", handleActivity, { passive: true });
        window.addEventListener("mousemove", handleActivity, { passive: true });
        window.addEventListener("pointerdown", handleActivity, { passive: true });

        const heartbeatInterval = setInterval(() => {
            if (provider.awareness) {
                provider.awareness.setLocalStateField("heartbeat", Date.now());
            }
        }, 15000);

        provider.awareness.setLocalStateField("heartbeat", Date.now());

        return () => {
            window.removeEventListener("keydown", handleActivity);
            window.removeEventListener("mousemove", handleActivity);
            window.removeEventListener("pointerdown", handleActivity);
            clearInterval(heartbeatInterval);
        };
    }, [provider]);

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
    } = useProjectDocDraftEditor({
        projectId: project.id,
        docSlug: normalizedDocSlug,
        initialContent: draft.draftContent || "",
        initialDraftUpdatedAt: draft.draftUpdatedAt,
        initialQualityReport: draft.qualityReport,
        onSave,
    });

    const hasSessionChanges = useMemo(() => {
        return normalizeProjectDocContent(content) !== initialContentRef.current || dirty;
    }, [content, dirty]);

    const handleBackClick = useCallback(() => {
        if (hasSessionChanges) {
            setShowDiscardConfirm(true);
        } else {
            onExit();
        }
    }, [hasSessionChanges, onExit]);

    const handleDiscardConfirm = useCallback(async () => {
        setDiscarding(true);
        try {
            const result = await onDiscardDraft();
            if (result && provider) {
                const ytext = ydoc.getText('markdown');
                syncYTextContent(ydoc, ytext, result.serverDraftContent ?? "", 'local-discard-sync');
            }
            clearLocalBackup();
            onExit();
        } catch (error) {
            console.error("Failed to discard draft:", error);
        } finally {
            setDiscarding(false);
            setShowDiscardConfirm(false);
        }
    }, [onDiscardDraft, provider, ydoc, clearLocalBackup, onExit]);

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
        const repairCollaborativeContent = (collaborativeContent: string) => {
            const resolution = resolveProjectDocCollaborationContent({
                canonicalContent: contentRef.current,
                collaborativeContent,
            });
            if (!resolution.repaired) return resolution.content;

            ydoc.transact(() => {
                ytext.delete(0, ytext.length);
                if (resolution.content) ytext.insert(0, resolution.content);
                const metaMap = ydoc.getMap('metadata');
                if (expectedDraftUpdatedAt) {
                    metaMap.set('draftUpdatedAt', expectedDraftUpdatedAt);
                }
                metaMap.set('lastRepairReason', resolution.reason);
                metaMap.set('lastRepairRepeatCount', resolution.repeatCount);
                metaMap.set('lastRepairAt', new Date().toISOString());
            }, 'local-collaboration-repair');

            return resolution.content;
        };
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
                                const metaMap = ydoc.getMap('metadata');
                                if (expectedDraftUpdatedAt) {
                                    metaMap.set('draftUpdatedAt', expectedDraftUpdatedAt);
                                }
                                metaMap.set('draftLength', contentRef.current.length);
                                ydoc.getText('markdown').insert(0, contentRef.current);
                            }, 'local-init');
                        }
                    }
                }, 500 + Math.random() * 2000);
            } else if (ytextContent !== contentRef.current) {
                setContent(repairCollaborativeContent(ytextContent), { isRemote: true });
            }
        }
        const observer = (_event: any, transaction: any) => {
            if (transaction?.origin === 'local-collaboration-repair') return;
            const isLocal = transaction?.local ?? true;
            const nextContent = repairCollaborativeContent(ytext.toString());
            setContent(nextContent, { isKeystroke: isLocal, isRemote: !isLocal });
        };
        ytext.observe(observer);
        return () => ytext.unobserve(observer);
    }, [collaborationEnabled, contentRef, ydoc, setContent, synced, provider, expectedDraftUpdatedAt]);

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
        return evaluateProjectDocQuality(qualityContent);
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
    const previewSourceTargets = useMemo(() => buildProjectDocEditorSourceTargets(content), [content]);
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
            .map((panel) => PROJECT_DOC_INSERT_ACTIONS.find((action) => action.id === panel))
            .filter((action): action is (typeof PROJECT_DOC_INSERT_ACTIONS)[number] => Boolean(action))
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
            const target = findProjectDocEditorSourceTarget(previewSourceTargets, position.selectionStart);
            if (!target) return;
            cursorRevealTokenRef.current += 1;
            setPreviewRevealTarget({ targetId: target.id, token: cursorRevealTokenRef.current });
        }, 150);
    }, [followCursor, previewSourceTargets, setCursorRange, setPreviewRevealTarget]);

    const openInsertPanel = useCallback((panel: ProjectDocMorePanel) => {
        setMoreOpen(true);
        setLocalNotice(null);

        if (panel === "reference") {
            setReferenceKindHint(inferReferenceKindFromText(content.slice(Math.max(0, (cursorRange?.selectionStart ?? content.length) - 180), cursorRange?.selectionStart ?? content.length)));
        } else {
            setReferenceKindHint(null);
        }

        setActivePanel(panel);
    }, [content, cursorRange, setActivePanel, setLocalNotice, setMoreOpen, setReferenceKindHint]);

    const defaultInsertPanel = useMemo<ProjectDocMorePanel>(
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

    const { complete } = useCompletion({
        api: '/api/completion',
        onFinish: (_prompt, completion) => {
            insertAtCursor(completion);
            setLocalNotice("AI Autocomplete finished.");
        },
        onError: () => {
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

    const handlePreviewSourcePosition = useCallback((position: ProjectDocEditorSourcePosition) => {
        const offset = typeof position.offset === "number" && Number.isFinite(position.offset)
            ? Math.max(0, Math.min(position.offset, content.length))
            : getDocLineStartOffset(content, position.line ?? null);
        const target = position.targetId
            ? previewSourceTargets.find((item) => item.id === position.targetId) ?? findProjectDocEditorSourceTarget(previewSourceTargets, offset)
            : findProjectDocEditorSourceTarget(previewSourceTargets, offset);
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
            setLocalNotice("Review document quality before publishing");
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
        if (!window.confirm("Set this version as the current published document? Your draft will switch to this content.")) return;
        const result = await onSetCurrentVersion(versionId);
        if (result) {
            updateDocumentContent(result.serverDraftContent ?? "");
            applyDraftResult(result, "Current version updated");
        }
        setActivePanel(null);
    }, [applyDraftResult, onSetCurrentVersion, updateDocumentContent, setActivePanel]);

    const handleDeleteVersion = useCallback(async (versionId: string) => {
        if (!window.confirm("Delete this document version from visible history? If it is current, the newest remaining version becomes current and the draft follows it.")) return;
        const result = await onDeleteVersion(versionId);
        if (result?.serverDraftContent != null) {
            updateDocumentContent(result.serverDraftContent);
            applyDraftResult(result, "Version deleted");
        } else {
            setLocalNotice("Version deleted");
        }
    }, [applyDraftResult, onDeleteVersion, updateDocumentContent, setLocalNotice]);

    const handleDiscardDraft = useCallback(async () => {
        if (!window.confirm("Discard the current document draft? Unpublished edits will be removed.")) return;
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
                const markdown = await uploadProjectDocAsset({
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
        setLocalNotice("Opened document at selected section");
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

    const panelCopy = activePanel === "style"
        ? { title: "Choose style", description: "Start from a portable document structure that matches the project type." }
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
                            ? { title: "Insert image", description: "Upload managed document media and place it at your cursor." }
                            : activePanel === "quality"
                                ? { title: "Doc quality", description: "Review missing guidance, media issues, unsafe links, and publish blockers." }
                                : activePanel === "history"
                                    ? { title: "Version history", description: "Restore, publish, delete versions, or discard the current draft." }
                                    : null;

    const overlay = (
        <>
            <div className={activePanel === "style" ? "block" : "hidden"}>
                <ProjectDocStyleBuilder projectName={project.title} onInsert={insertAtCursor} onClose={closePanel} />
            </div>
            <div className={activePanel === "table" ? "block" : "hidden"}>
                <ProjectDocTableBuilder onInsert={insertAtCursor} onClose={closePanel} />
            </div>
            {activePanel === "command" && (
                <div className="block">
                    <ProjectDocCommandBuilder selectedMarkdown={selectedMarkdown} onInsert={insertAtCursor} onClose={closePanel} />
                </div>
            )}
            {activePanel === "callout" && (
                <div className="block">
                    <ProjectDocCalloutBuilder onInsert={insertAtCursor} onClose={closePanel} />
                </div>
            )}
            {activePanel === "link" && (
                <div className="block">
                    <ProjectDocLinkBuilder onInsert={insertAtCursor} onClose={closePanel} />
                </div>
            )}
            {activePanel === "reference" && (
                <div className="block">
                    <ProjectDocReferencePicker projectId={project.id} initialKind={referenceKindHint ?? undefined} onInsert={insertAtCursor} onClose={closePanel} />
                </div>
            )}
            {activePanel === "assets" && (
                <div className="block">
                    <ProjectDocAssetManager projectId={project.id} projectVisibility={project.visibility} selectedMarkdown={selectedMarkdown} onInserted={(markdown) => {
                        insertAtCursor(markdown);
                        closePanel();
                    }} />
                </div>
            )}
            <div className={activePanel === "quality" ? "block" : "hidden"}>
                <ProjectDocQualityPanel
                    report={qualityReport}
                    onInsertFix={insertAtCursor}
                    onJumpToSection={handleQualityJumpToSection}
                />
            </div>
            <div className={activePanel === "history" ? "block" : "hidden"}>
                <ProjectDocHistory
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
            <ProjectDocInsertCommandCenter
                open={moreOpen}
                activePanel={activePanel}
                panelTitle={panelCopy?.title ?? ""}
                panelDescription={panelCopy?.description ?? ""}
                onPanelChange={openInsertPanel}
                onClose={closePanel}
                projectName={project.title}
            >
                {overlay}
            </ProjectDocInsertCommandCenter>

            <ProjectDocPublishModal
                projectId={project.id}
                open={publishModalOpen}
                onOpenChange={setPublishModalOpen}
                onPublish={performPublish}
                isPublishing={publishing}
                data-readme-publish-readiness-gate="true"
            />

            {conflict && (
                <ProjectDocConflictResolver
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
                            onClick={handleBackClick}
                            className="inline-flex h-8 items-center gap-2 rounded-full px-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            title="Go back"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            <span className="hidden sm:inline">Back</span>
                        </button>
                        <div className="hidden sm:block h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
                        <div className="flex items-center gap-3 min-w-0">
                            {draft.linkedNode ? (
                                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-medium text-zinc-500 dark:text-zinc-400">
                                    <Link className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
                                    <span>Linked by file: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{draft.linkedNode.name}</span></span>
                                </div>
                            ) : (
                                <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                    {docSlug === "readme" ? "README.md" : docSlug}
                                </p>
                            )}
                            
                            <button 
                                type="button" 
                                className="hidden md:inline-flex text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400 transition" 
                                title="Press Cmd/Ctrl+K to insert project mentions"
                            >
                                <Keyboard className="h-4 w-4" />
                            </button>
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
                                title={visualEditorAvailable ? "Visual editor" : "Visual editor requires document collaboration to be configured"}
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
                        <ProjectDocMoreMenu
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
                            title="Publish Document"
                        >
                            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            <span>Publish</span>
                        </button>
                    </div>
                </div>

                {/* Collaboration Room Limit Alert Banner */}
                {roomFull && !pendingPromotionActive && (
                    <div className="z-20 flex items-center justify-between gap-3 bg-rose-50 px-6 py-3 text-xs font-medium text-rose-700 border-b border-rose-100 dark:bg-rose-950/20 dark:text-rose-300 dark:border-rose-900/30 animate-in slide-in-from-top duration-300">
                        <div className="flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-500" />
                            <span>Room limit reached (max 5 editors). Syncing is currently paused. Please wait for someone to leave to resume editing collaboration.</span>
                        </div>
                    </div>
                )}

                {/* Collaboration Promotion Alert Banner */}
                {pendingPromotionActive && (
                    <div className="z-20 flex items-center justify-between gap-3 bg-blue-50 px-6 py-3 text-xs font-medium text-blue-700 border-b border-blue-100 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-900/30 animate-in slide-in-from-top duration-300">
                        <div className="flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 shrink-0 text-blue-500 animate-pulse" />
                            <span>An editing slot has opened up! You have {promotionCountdown} seconds to claim your editor slot.</span>
                        </div>
                        <button
                            type="button"
                            onClick={handleAcceptPromotion}
                            className="inline-flex h-7 items-center justify-center rounded-full bg-blue-600 px-4 text-xs font-semibold text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
                        >
                            Accept Promotion
                        </button>
                    </div>
                )}



                <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-2" data-readme-split-editor="true" data-readme-equal-split="50-50" data-readme-parallel-sync="scroll-and-cursor-heading" data-readme-split-fills-remaining-viewport="true">
                    <section className="flex min-h-0 min-w-0 flex-col border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:border-b-0 lg:border-r" aria-label="Document Markdown editor">
                        <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800" data-readme-write-pane-title="true">
                            <div className="flex items-center gap-3 min-w-0">
                                <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Write</p>

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

                                {localNotice ? (
                                    <span className="hidden sm:inline max-w-52 truncate text-xs text-zinc-400" role="status" aria-live="polite">
                                        · {localNotice}
                                    </span>
                                ) : null}
                            </div>
                            <span className="text-xs text-zinc-500">Markdown</span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden" data-readme-editor-code-surface="true" data-readme-bottom-gap-guard="true">
                            {effectiveEditorMode === "visual" ? (
                                provider ? (
                                    <ProjectDocWysiwygEditor
                                        ydoc={ydoc}
                                        provider={provider}
                                        synced={synced}
                                        initialContent={content}
                                        currentUserName={currentUserName}
                                        onContentChange={handleVisualContentChange}
                                        readOnly={roomFull}
                                    />
                                ) : (
                                    <EditorSkeleton />
                                )
                            ) : (
                                <CodeEditor
                                    filename={normalizedDocSlug === "readme" ? "README.md" : `${normalizedDocSlug.toUpperCase()}.md`}
                                    value={content}
                                    onChange={(nextValue) => {
                                        if (!provider && !roomFull) {
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
                                    readOnly={roomFull}
                                />
                            )}
                        </div>
                    </section>

                    <aside className="flex min-h-0 min-w-0 flex-col bg-zinc-50/40 dark:bg-zinc-950" aria-label="Document Live Review" data-readme-live-review-pane="true">
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
                                <ProjectDocRenderer
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
                                    docSlug={normalizedDocSlug}
                                />
                            </div>
                        </div>
                    </aside>
                </div>
            </div>

            <Dialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
                <DialogContent className="sm:max-w-md bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Discard unsaved changes?</DialogTitle>
                        <DialogDescription>
                            You have unsaved changes in your document. If you leave now, these changes will be discarded.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex justify-end gap-2 mt-4">
                        <Button type="button" variant="ghost" onClick={() => setShowDiscardConfirm(false)} disabled={discarding}>
                            Keep Editing
                        </Button>
                        <Button type="button" variant="destructive" onClick={handleDiscardConfirm} disabled={discarding}>
                            Discard
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
