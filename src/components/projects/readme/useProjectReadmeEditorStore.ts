import { create } from "zustand";
import type { ProjectReadmeMorePanel } from "@/components/projects/readme/ProjectReadmeMoreMenu";
import type { ProjectReadmeReferenceKind } from "@/lib/projects/readme-blocks";

export type CursorRange = { selectionStart: number; selectionEnd: number };
export type EditorSelectionTarget = { from: number; to: number; token: number };
export type PreviewRevealTarget = { targetId: string; token: number };
export type SourceHighlightTarget = { from: number; to: number; token: number };
export type LiveReviewSize = "fluid" | "github" | "tablet" | "mobile";

interface ProjectReadmeEditorState {
    activePanel: ProjectReadmeMorePanel | null;
    moreOpen: boolean;
    cursorRange: CursorRange | null;
    referenceKindHint: ProjectReadmeReferenceKind | null;
    selectionTarget: EditorSelectionTarget | null;
    previewRevealTarget: PreviewRevealTarget | null;
    sourceHighlightTarget: SourceHighlightTarget | null;
    liveReviewSize: LiveReviewSize;
    followCursor: boolean;
    editorMode: "code" | "visual";

    setActivePanel: (panel: ProjectReadmeMorePanel | null | ((current: ProjectReadmeMorePanel | null) => ProjectReadmeMorePanel | null)) => void;
    setMoreOpen: (open: boolean) => void;
    setCursorRange: (range: CursorRange | null | ((current: CursorRange | null) => CursorRange | null)) => void;
    setReferenceKindHint: (hint: ProjectReadmeReferenceKind | null) => void;
    setSelectionTarget: (target: EditorSelectionTarget | null) => void;
    setPreviewRevealTarget: (target: PreviewRevealTarget | null | ((current: PreviewRevealTarget | null) => PreviewRevealTarget | null)) => void;
    setSourceHighlightTarget: (target: SourceHighlightTarget | null | ((current: SourceHighlightTarget | null) => SourceHighlightTarget | null)) => void;
    setLiveReviewSize: (size: LiveReviewSize) => void;
    setFollowCursor: (follow: boolean | ((current: boolean) => boolean)) => void;
    setEditorMode: (mode: "code" | "visual") => void;
}

export const useProjectReadmeEditorStore = create<ProjectReadmeEditorState>((set) => ({
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
