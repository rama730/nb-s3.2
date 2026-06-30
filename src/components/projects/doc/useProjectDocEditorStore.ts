import { create } from "zustand";
import type { ProjectDocMorePanel } from "@/components/projects/doc/ProjectDocMoreMenu";
import type { ProjectDocReferenceKind } from "@/lib/projects/doc-blocks";

export type CursorRange = { selectionStart: number; selectionEnd: number };
export type EditorSelectionTarget = { from: number; to: number; token: number };
export type PreviewRevealTarget = { targetId: string; token: number };
export type SourceHighlightTarget = { from: number; to: number; token: number };
export type LiveReviewSize = "fluid" | "github" | "tablet" | "mobile";

interface ProjectDocEditorState {
    activePanel: ProjectDocMorePanel | null;
    moreOpen: boolean;
    cursorRange: CursorRange | null;
    referenceKindHint: ProjectDocReferenceKind | null;
    selectionTarget: EditorSelectionTarget | null;
    previewRevealTarget: PreviewRevealTarget | null;
    sourceHighlightTarget: SourceHighlightTarget | null;
    liveReviewSize: LiveReviewSize;
    followCursor: boolean;
    editorMode: "code" | "visual";

    setActivePanel: (panel: ProjectDocMorePanel | null | ((current: ProjectDocMorePanel | null) => ProjectDocMorePanel | null)) => void;
    setMoreOpen: (open: boolean) => void;
    setCursorRange: (range: CursorRange | null | ((current: CursorRange | null) => CursorRange | null)) => void;
    setReferenceKindHint: (hint: ProjectDocReferenceKind | null) => void;
    setSelectionTarget: (target: EditorSelectionTarget | null) => void;
    setPreviewRevealTarget: (target: PreviewRevealTarget | null | ((current: PreviewRevealTarget | null) => PreviewRevealTarget | null)) => void;
    setSourceHighlightTarget: (target: SourceHighlightTarget | null | ((current: SourceHighlightTarget | null) => SourceHighlightTarget | null)) => void;
    setLiveReviewSize: (size: LiveReviewSize) => void;
    setFollowCursor: (follow: boolean | ((current: boolean) => boolean)) => void;
    setEditorMode: (mode: "code" | "visual") => void;
}

export const useProjectDocEditorStore = create<ProjectDocEditorState>((set) => ({
    activePanel: null,
    moreOpen: false,
    cursorRange: null,
    referenceKindHint: null,
    selectionTarget: null,
    previewRevealTarget: null,
    sourceHighlightTarget: null,
    liveReviewSize: "fluid",
    followCursor: true,
    editorMode: "code",

    setActivePanel: (updater) => set((state) => ({
        activePanel: typeof updater === "function" ? updater(state.activePanel) : updater
    })),
    setMoreOpen: (open) => set({ moreOpen: open }),
    setCursorRange: (updater) => set((state) => ({
        cursorRange: typeof updater === "function" ? updater(state.cursorRange) : updater
    })),
    setReferenceKindHint: (hint) => set({ referenceKindHint: hint }),
    setSelectionTarget: (target) => set({ selectionTarget: target }),
    setPreviewRevealTarget: (updater) => set((state) => ({
        previewRevealTarget: typeof updater === "function" ? updater(state.previewRevealTarget) : updater
    })),
    setSourceHighlightTarget: (updater) => set((state) => ({
        sourceHighlightTarget: typeof updater === "function" ? updater(state.sourceHighlightTarget) : updater
    })),
    setLiveReviewSize: (size) => set({ liveReviewSize: size }),
    setFollowCursor: (updater) => set((state) => ({
        followCursor: typeof updater === "function" ? updater(state.followCursor) : updater
    })),
    setEditorMode: (mode) => set({ editorMode: mode }),
}));
