"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Pencil } from "lucide-react";

import { useProjectReadmeSmartBlockPreviews } from "@/hooks/hub/useProjectReadmeData";
import type { ProjectReadmePublishedPayload } from "@/lib/projects/readme";
import type { ProjectReadmeSmartBlockPreview } from "@/lib/projects/readme-blocks";
import { decodeReadmeHashTarget } from "@/lib/projects/readme-navigation";
import { buildProjectReadmeViewModel, type ProjectReadmeRailAction } from "@/lib/projects/readme-view-model";
import type { Project } from "@/types/hub";

const ProjectReadmeQuickConsole = dynamic(
    () => import("@/components/projects/readme/ProjectReadmeQuickConsole").then((mod) => mod.ProjectReadmeQuickConsole),
    { loading: () => null, ssr: false },
);

const ProjectReadmeRenderer = dynamic(
    () => import("@/components/projects/readme/ProjectReadmeRenderer").then((mod) => mod.ProjectReadmeRenderer),
    { loading: () => null, ssr: false },
);

function shouldReduceMotion() {
    return document.documentElement.dataset.reduceMotion === "true"
        || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const README_TARGET_SCROLL_GAP = 20;
const README_TARGET_SCROLL_BOTTOM_GAP = 48;
const README_TARGET_CENTER_RATIO = 0.5;
const README_HEADING_REVEAL_RATIO = 0.38;
const README_TALL_TARGET_RATIO = 0.82;
const README_RAIL_MEMORY_VERSION = 1;
const README_DESKTOP_RAIL_QUERY = "(min-width: 1280px)";

function getIsWideReadmeRail() {
    return typeof window !== "undefined" && window.matchMedia(README_DESKTOP_RAIL_QUERY).matches;
}

function getRouteScrollRoot() {
    return document.querySelector<HTMLElement>('[data-scroll-root="route"]');
}

function getStickyProjectOffset(routeRoot: HTMLElement | null) {
    const stickyTabs = document.querySelector<HTMLElement>('[data-project-sticky-tabs="true"]');
    if (!stickyTabs) return 0;
    const stickyRect = stickyTabs.getBoundingClientRect();
    const rootTop = routeRoot?.getBoundingClientRect().top ?? 0;
    return stickyRect.bottom > rootTop && stickyRect.top <= rootTop + 8 ? stickyRect.height : 0;
}

function resolveReadmeRevealElement(target: HTMLElement) {
    if (target.dataset.readmeTargetKind === "command") {
        return target.closest<HTMLElement>('[data-readme-command-block="true"]') ?? target;
    }
    return target;
}

function readmeRevealRatioForTarget(target: HTMLElement) {
    return target.dataset.readmeTargetKind === "heading"
        ? README_HEADING_REVEAL_RATIO
        : README_TARGET_CENTER_RATIO;
}

function getReadmeVisibleMetrics(routeRoot: HTMLElement | null) {
    const stickyOffset = getStickyProjectOffset(routeRoot);
    const rootRect = routeRoot?.getBoundingClientRect() ?? {
        top: 0,
        bottom: window.innerHeight,
        height: window.innerHeight,
    };
    const visibleStart = stickyOffset + README_TARGET_SCROLL_GAP;
    const visibleHeight = Math.max(
        160,
        rootRect.height - stickyOffset - README_TARGET_SCROLL_GAP - README_TARGET_SCROLL_BOTTOM_GAP,
    );

    return {
        currentScrollTop: routeRoot ? routeRoot.scrollTop : window.scrollY,
        rootTop: rootRect.top,
        visibleStart,
        visibleHeight,
    };
}

function getCenteredReadmeScrollTop(target: HTMLElement, revealElement: HTMLElement, routeRoot: HTMLElement | null) {
    const metrics = getReadmeVisibleMetrics(routeRoot);
    const elementRect = revealElement.getBoundingClientRect();
    const elementTop = metrics.currentScrollTop + elementRect.top - metrics.rootTop;
    const ratio = readmeRevealRatioForTarget(target);

    if (elementRect.height >= metrics.visibleHeight * README_TALL_TARGET_RATIO) {
        return Math.max(0, elementTop - metrics.visibleStart);
    }

    const targetTopWithinViewport = metrics.visibleStart + (metrics.visibleHeight * ratio) - (elementRect.height / 2);
    return Math.max(0, elementTop - targetTopWithinViewport);
}

function scrollReadmeTargetIntoView(target: HTMLElement, behavior: ScrollBehavior) {
    const routeRoot = getRouteScrollRoot();
    const revealElement = resolveReadmeRevealElement(target);
    const top = getCenteredReadmeScrollTop(target, revealElement, routeRoot);

    if (routeRoot) {
        routeRoot.scrollTo({
            top,
            behavior,
        });
        return;
    }

    window.scrollTo({ top, behavior });
}

type ReadmeTargetFlash = {
    targetId: string;
    token: number;
};

type ReadmeRailUiState = {
    openTab: ProjectReadmeRailAction["railTab"] | null;
    selectedActionId: string | null;
};

type ReadmeRailMemory = ReadmeRailUiState & {
    version: typeof README_RAIL_MEMORY_VERSION;
    targetSignature: string;
};

function isReadmeRailTab(value: unknown, railTabs: ProjectReadmeRailAction["railTab"][]): value is ProjectReadmeRailAction["railTab"] {
    return typeof value === "string" && railTabs.includes(value as ProjectReadmeRailAction["railTab"]);
}

export function ProjectReadmeViewer({
    project,
    payload,
    onEdit,
}: {
    project: Project;
    payload: ProjectReadmePublishedPayload;
    onEdit: () => void;
}) {
    const version = payload.version;
    const readmeContent = version?.content ?? "";
    const storedReadmeHeadings = version?.headings;
    const readmeExcerpt = version?.excerpt ?? null;
    const readmeViewModel = useMemo(() => buildProjectReadmeViewModel({
        content: readmeContent,
        contentHash: version?.contentHash,
        excerpt: readmeExcerpt,
        storedHeadings: storedReadmeHeadings,
    }), [readmeContent, readmeExcerpt, storedReadmeHeadings, version?.contentHash]);
    const previewBlocks = payload.settings.projectBlocks
        ? readmeViewModel.previewBlocks
        : readmeViewModel.referencePreviewBlocks;
    const readmePreviewsQuery = useProjectReadmeSmartBlockPreviews(
        project.id,
        previewBlocks,
        previewBlocks.length > 0,
    );
    const previewByKey = useMemo(() => {
        const map = new Map<string, ProjectReadmeSmartBlockPreview>();
        for (const preview of readmePreviewsQuery.data ?? []) map.set(preview.key, preview);
        return map;
    }, [readmePreviewsQuery.data]);
    const railActions = useMemo(() => readmeViewModel.railActions.map((action) => {
        if (action.kind !== "reference" || !action.referencePreviewKey) return action;
        const preview = previewByKey.get(action.referencePreviewKey);
        const option = preview?.items[0] ?? null;
        return {
            ...action,
            openHref: option?.href ?? preview?.href ?? null,
            previewOption: option,
            previewLoading: readmePreviewsQuery.isLoading,
            previewError: readmePreviewsQuery.isError,
        } satisfies ProjectReadmeRailAction;
    }), [previewByKey, readmePreviewsQuery.isError, readmePreviewsQuery.isLoading, readmeViewModel.railActions]);
    const recommendedAction = useMemo(() => {
        if (!readmeViewModel.recommendedAction) return null;
        return railActions.find((action) => action.id === readmeViewModel.recommendedAction?.id) ?? readmeViewModel.recommendedAction;
    }, [railActions, readmeViewModel.recommendedAction]);
    const hasQuickRail = readmeViewModel.railTabs.length > 0;
    const [highlightedTarget, setHighlightedTarget] = useState<ReadmeTargetFlash | null>(null);
    const [railState, setRailState] = useState<ReadmeRailUiState>({ openTab: null, selectedActionId: null });
    const [isWideRail, setIsWideRail] = useState(getIsWideReadmeRail);
    const highlightTimerRef = useRef<number | null>(null);
    const scrollFrameRef = useRef<number | null>(null);
    const mediaCorrectionFrameRef = useRef<number | null>(null);
    const targetRetryTimerRef = useRef<number | null>(null);
    const highlightTokenRef = useRef(0);
    const lastRevealTargetIdRef = useRef<string | null>(null);
    const restoredRailMemoryKeyRef = useRef<string | null>(null);
    const readmeTargetIds = readmeViewModel.targetIds;
    const readmeTargetSignature = readmeViewModel.targetSignature;
    const readmeRailMemoryKey = useMemo(() => (
        `project-readme-rail:${project.id}:${version?.contentHash ?? version?.id ?? "draft"}`
    ), [project.id, version?.contentHash, version?.id]);
    const railActionIdSet = useMemo(() => new Set(railActions.map((action) => action.id)), [railActions]);
    const actionByTargetId = useMemo(() => {
        const map = new Map<string, ProjectReadmeRailAction>();
        railActions.forEach((action) => {
            if (!map.has(action.targetId)) map.set(action.targetId, action);
        });
        return map;
    }, [railActions]);

    const flashTarget = useCallback((targetId: string) => {
        highlightTokenRef.current += 1;
        const token = highlightTokenRef.current;
        setHighlightedTarget({ targetId, token });
        if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => {
            setHighlightedTarget((current) => current?.targetId === targetId && current.token === token ? null : current);
        }, 1800);
    }, []);

    const updateHash = useCallback((targetId: string) => {
        const url = new URL(window.location.href);
        url.hash = encodeURIComponent(targetId);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }, []);

    const scrollToTarget = useCallback((rawTargetId: string, options?: {
        behavior?: ScrollBehavior;
        defer?: boolean;
        highlight?: boolean;
        retry?: boolean;
        retries?: number;
        updateHash?: boolean;
    }) => {
        const targetId = decodeReadmeHashTarget(rawTargetId) ?? rawTargetId;
        const revealTarget = (attemptsRemaining: number): boolean => {
            const element = document.getElementById(targetId);
            if (!element) {
                if (options?.retry !== false && attemptsRemaining > 0) {
                    if (targetRetryTimerRef.current) window.clearTimeout(targetRetryTimerRef.current);
                    targetRetryTimerRef.current = window.setTimeout(() => revealTarget(attemptsRemaining - 1), 50);
                }
                return false;
            }

            if (targetRetryTimerRef.current) {
                window.clearTimeout(targetRetryTimerRef.current);
                targetRetryTimerRef.current = null;
            }
            const behavior = options?.behavior ?? (shouldReduceMotion() ? "auto" : "smooth");
            scrollReadmeTargetIntoView(element, behavior);
            lastRevealTargetIdRef.current = targetId;
            if (typeof element.focus === "function") {
                element.focus({ preventScroll: true });
            }
            if (options?.highlight !== false) flashTarget(targetId);
            if (options?.updateHash !== false) updateHash(targetId);
            return true;
        };

        if (options?.defer) {
            if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
            scrollFrameRef.current = window.requestAnimationFrame(() => {
                scrollFrameRef.current = window.requestAnimationFrame(() => {
                    scrollFrameRef.current = null;
                    revealTarget(options?.retries ?? 20);
                });
            });
            return true;
        }

        return revealTarget(options?.retries ?? 20);
    }, [flashTarget, updateHash]);

    const handleReadmeMediaLoad = useCallback(() => {
        const targetId = highlightedTarget?.targetId ?? lastRevealTargetIdRef.current;
        if (!targetId) return;
        if (mediaCorrectionFrameRef.current) window.cancelAnimationFrame(mediaCorrectionFrameRef.current);
        mediaCorrectionFrameRef.current = window.requestAnimationFrame(() => {
            mediaCorrectionFrameRef.current = null;
            scrollToTarget(targetId, {
                behavior: "auto",
                highlight: false,
                retry: false,
                retries: 0,
                updateHash: false,
            });
        });
    }, [highlightedTarget?.targetId, scrollToTarget]);

    const handleRailAction = useCallback((action: ProjectReadmeRailAction) => {
        scrollToTarget(action.targetId, { defer: true, highlight: true, updateHash: true });
    }, [scrollToTarget]);

    const selectRailActionForTarget = useCallback((targetId: string) => {
        const action = actionByTargetId.get(targetId);
        if (!action) return;
        setRailState({ openTab: action.railTab, selectedActionId: action.id });
    }, [actionByTargetId]);

    useEffect(() => {
        if (!readmeTargetIds.length) return;
        let cancelled = false;
        let timer: number | null = null;
        const resolveHashTarget = (attemptsRemaining: number) => {
            if (cancelled) return;
            const targetId = decodeReadmeHashTarget(window.location.hash);
            if (!targetId) return;
            if (scrollToTarget(targetId, { behavior: "auto", highlight: true, retry: false, updateHash: false })) {
                selectRailActionForTarget(targetId);
                return;
            }
            if (attemptsRemaining > 0) {
                timer = window.setTimeout(() => resolveHashTarget(attemptsRemaining - 1), 50);
            }
        };
        const frame = window.requestAnimationFrame(() => resolveHashTarget(20));
        const handleHashChange = () => resolveHashTarget(20);
        window.addEventListener("hashchange", handleHashChange);

        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
            if (timer) window.clearTimeout(timer);
            window.removeEventListener("hashchange", handleHashChange);
        };
    }, [readmeTargetIds.length, readmeTargetSignature, scrollToTarget, selectRailActionForTarget]);

    useEffect(() => {
        if (!hasQuickRail || restoredRailMemoryKeyRef.current === readmeRailMemoryKey) return;
        restoredRailMemoryKeyRef.current = readmeRailMemoryKey;
        try {
            const rawMemory = window.sessionStorage.getItem(readmeRailMemoryKey);
            if (!rawMemory) return;
            const memory = JSON.parse(rawMemory) as Partial<ReadmeRailMemory>;
            if (memory.version !== README_RAIL_MEMORY_VERSION || memory.targetSignature !== readmeTargetSignature) return;
            const openTab = isReadmeRailTab(memory.openTab, readmeViewModel.railTabs) ? memory.openTab : null;
            const selectedActionId = typeof memory.selectedActionId === "string" && railActionIdSet.has(memory.selectedActionId)
                ? memory.selectedActionId
                : null;
            if (!openTab && !selectedActionId) return;
            setRailState({ openTab, selectedActionId });
        } catch {
            window.sessionStorage.removeItem(readmeRailMemoryKey);
        }
    }, [hasQuickRail, railActionIdSet, readmeRailMemoryKey, readmeTargetSignature, readmeViewModel.railTabs]);

    useEffect(() => {
        if (!hasQuickRail || restoredRailMemoryKeyRef.current !== readmeRailMemoryKey) return;
        try {
            const memory: ReadmeRailMemory = {
                version: README_RAIL_MEMORY_VERSION,
                targetSignature: readmeTargetSignature,
                openTab: railState.openTab,
                selectedActionId: railState.selectedActionId,
            };
            window.sessionStorage.setItem(readmeRailMemoryKey, JSON.stringify(memory));
        } catch {
            // Storage can be unavailable in private contexts; rail behavior still works without memory.
        }
    }, [hasQuickRail, railState.openTab, railState.selectedActionId, readmeRailMemoryKey, readmeTargetSignature]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const media = window.matchMedia(README_DESKTOP_RAIL_QUERY);
        const handleChange = () => setIsWideRail(media.matches);
        handleChange();
        media.addEventListener("change", handleChange);
        return () => media.removeEventListener("change", handleChange);
    }, []);

    useEffect(() => {
        return () => {
            if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
            if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
            if (mediaCorrectionFrameRef.current) window.cancelAnimationFrame(mediaCorrectionFrameRef.current);
            if (targetRetryTimerRef.current) window.clearTimeout(targetRetryTimerRef.current);
        };
    }, []);

    if (!version) return null;

    return (
        <div className="relative mx-auto w-full max-w-[1480px] px-4 py-0 sm:px-6 lg:px-8">
            {payload.canEdit ? (
                <button
                    type="button"
                    onClick={onEdit}
                    className="absolute right-4 top-0 z-10 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-sm font-semibold text-zinc-700 backdrop-blur transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-200 sm:right-6 lg:right-8"
                >
                    <Pencil className="h-4 w-4" />
                    Edit
                </button>
            ) : null}

            <div className={hasQuickRail && isWideRail ? "grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]" : ""}>
                <div className="min-w-0">
                    {hasQuickRail && !isWideRail ? (
                        <ProjectReadmeQuickConsole
                            excerpt={readmeExcerpt}
                            headings={readmeViewModel.headings}
                            commands={readmeViewModel.commands}
                            references={readmeViewModel.references}
                            report={readmeViewModel.report}
                            railActions={railActions}
                            recommendedAction={recommendedAction}
                            highlightedTargetId={highlightedTarget?.targetId}
                            highlightedTargetToken={highlightedTarget?.token}
                            instanceId="mobile"
                            openTab={railState.openTab}
                            onRailAction={handleRailAction}
                            onOpenTabChange={(openTab) => setRailState((current) => ({ ...current, openTab }))}
                            onSelectedActionChange={(selectedActionId) => setRailState((current) => ({ ...current, selectedActionId }))}
                            railTabs={readmeViewModel.railTabs}
                            referencePreviewByKey={previewByKey}
                            referencesError={readmePreviewsQuery.isError}
                            referencesLoading={readmePreviewsQuery.isLoading}
                            selectedActionId={railState.selectedActionId}
                            variant="compact"
                            className="mb-5"
                        />
                    ) : null}
                    <ProjectReadmeRenderer
                        content={version.content}
                        project={project}
                        allowExternalImages={payload.settings.externalImages}
                        allowSmartBlocks={payload.settings.projectBlocks}
                        className="mx-auto max-w-none"
                        highlightedTargetId={highlightedTarget?.targetId}
                        highlightedTargetToken={highlightedTarget?.token}
                        onRequestTarget={scrollToTarget}
                        onMediaLoad={handleReadmeMediaLoad}
                        previewByKey={previewByKey}
                        previewsLoading={readmePreviewsQuery.isLoading}
                        viewModel={readmeViewModel}
                    />
                </div>
                {hasQuickRail && isWideRail ? (
                    <aside>
                        <div className="sticky top-24">
                            <ProjectReadmeQuickConsole
                                excerpt={readmeExcerpt}
                                headings={readmeViewModel.headings}
                                commands={readmeViewModel.commands}
                                references={readmeViewModel.references}
                                report={readmeViewModel.report}
                                railActions={railActions}
                                recommendedAction={recommendedAction}
                                highlightedTargetId={highlightedTarget?.targetId}
                                highlightedTargetToken={highlightedTarget?.token}
                                instanceId="desktop"
                                openTab={railState.openTab}
                                onRailAction={handleRailAction}
                                onOpenTabChange={(openTab) => setRailState((current) => ({ ...current, openTab }))}
                                onSelectedActionChange={(selectedActionId) => setRailState((current) => ({ ...current, selectedActionId }))}
                                railTabs={readmeViewModel.railTabs}
                                referencePreviewByKey={previewByKey}
                                referencesError={readmePreviewsQuery.isError}
                                referencesLoading={readmePreviewsQuery.isLoading}
                                selectedActionId={railState.selectedActionId}
                            />
                        </div>
                    </aside>
                ) : null}
            </div>
        </div>
    );
}
