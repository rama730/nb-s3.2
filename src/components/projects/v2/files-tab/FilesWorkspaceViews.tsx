"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import {
  Folder,
  ListTodo,
  FileCheck2,
  Clock3,
  Star,
  Trash2,
} from "lucide-react";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useNavigateTo } from "./hooks/useNavigateTo";

export type FilesInspector =
  | "details"
  | "linked_tasks"
  | "version_history"
  | "github"
  | null;
export type FilesWorkspaceView =
  | "project"
  | "tasks"
  | "deliverables"
  | "recent"
  | "starred"
  | "trash";
export const fileCollectionViews = [
  { id: "project", label: "Project files", Icon: Folder },
  { id: "tasks", label: "Task files", Icon: ListTodo },
  { id: "deliverables", label: "Deliverables", Icon: FileCheck2 },
  { id: "recent", label: "Recent", Icon: Clock3 },
  { id: "starred", label: "Starred", Icon: Star },
  { id: "trash", label: "Trash", Icon: Trash2 },
] as const;
const WorkspaceContext = createContext<{
  scrollOffsets: React.RefObject<Map<string, number>>;
  view: FilesWorkspaceView;
  inspector: FilesInspector;
  setInspector: React.Dispatch<React.SetStateAction<FilesInspector>>;
  taskId: string | null;
  query: string;
  setQuery: (query: string) => void;
  sidebarMode: "collections" | "tree";
  showTree: () => void;
  showCollections: () => void;
  canReadTasks: boolean;
  returnToCollection: () => void;
  selectView: (view: FilesWorkspaceView) => void;
  selectTask: (id: string | null) => void;
} | null>(null);
export const useFilesWorkspaceView = () => useContext(WorkspaceContext);

export function FilesWorkspaceViews({
  projectId,
  canReadTasks,
  children,
}: {
  projectId: string;
  canReadTasks: boolean;
  children: React.ReactNode;
}) {
  const scrollOffsets = useRef(new Map<string, number>());
  const { canEdit } = useFilesTabRole();
  const [inspector, setInspector] = useState<FilesInspector>(null);
  const [pendingChange, setPendingChange] = useState<{
    view: FilesWorkspaceView;
    taskId: string | null;
    preserveQuery: boolean;
  } | null>(null);
  const [view, setView] = useState<FilesWorkspaceView>("project");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sidebarMode, setSidebarMode] = useState<"collections" | "tree">(
    "collections",
  );
  const navigateTo = useNavigateTo(projectId);
  const restoreView = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("filesView") as FilesWorkspaceView;
    setView(
      fileCollectionViews.some((item) => item.id === value) &&
        (canEdit || value !== "trash") &&
        (canReadTasks || !["tasks", "deliverables"].includes(value))
        ? value
        : "project",
    );
    setTaskId(params.get("filesTask"));
    setQuery(params.get("filesQuery") ?? "");
    setSidebarMode(
      params.get("filesNav") === "tree" ||
        (!params.has("filesNav") &&
          !value &&
          (params.has("path") || params.has("fileId")))
        ? "tree"
        : "collections",
    );
  }, [canReadTasks, canEdit]);
  useEffect(() => {
    restoreView();
    window.addEventListener("popstate", restoreView);
    return () => window.removeEventListener("popstate", restoreView);
  }, [restoreView]);
  function change(
    nextView: FilesWorkspaceView,
    nextTask: string | null,
    preserveQuery = false,
  ) {
    if (useFilesWorkspaceStore.getState().byProjectId[projectId]?.dirtyFileId) {
      setPendingChange({ view: nextView, taskId: nextTask, preserveQuery });
      return;
    }
    setInspector(null);
    navigateTo(null);
    setView(nextView);
    setTaskId(nextTask);

    setSidebarMode(nextView === "project" ? "tree" : "collections");
    const url = new URL(window.location.href);
    url.searchParams.delete("path");
    url.searchParams.delete("fileId");
    url.searchParams.delete("filesPanel");
    let nextQuery = preserveQuery ? query : "";
    if (nextView === view && nextTask !== taskId) {
      if (nextTask) {
        url.searchParams.set("filesGroupQuery", query);
        nextQuery = "";
      } else {
        nextQuery = url.searchParams.get("filesGroupQuery") ?? "";
        url.searchParams.delete("filesGroupQuery");
      }
    } else if (nextView !== view) url.searchParams.delete("filesGroupQuery");
    setQuery(nextQuery);
    if (nextQuery) url.searchParams.set("filesQuery", nextQuery);
    else url.searchParams.delete("filesQuery");
    if (nextView === "project") url.searchParams.set("filesNav", "tree");
    else url.searchParams.delete("filesNav");
    if (nextView === "project") url.searchParams.delete("filesView");
    else url.searchParams.set("filesView", nextView);
    if (nextTask) url.searchParams.set("filesTask", nextTask);
    else url.searchParams.delete("filesTask");
    window.history.pushState(window.history.state, "", url);
  }
  const selectView = (value: FilesWorkspaceView) => change(value, null);
  const selectTask = (id: string | null) => change(view, id, true);
  function setNavigation(mode: "collections" | "tree") {
    setSidebarMode(mode);
    const url = new URL(window.location.href);
    url.searchParams.set("filesNav", mode);
    window.history.replaceState(window.history.state, "", url);
  }
  function updateQuery(value: string) {
    setQuery(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("filesQuery", value);
    else url.searchParams.delete("filesQuery");
    window.history.replaceState(window.history.state, "", url);
  }
  return (
    <WorkspaceContext.Provider
      value={{
        scrollOffsets,
        view,
        inspector,
        setInspector,
        taskId,
        query,
        setQuery: updateQuery,
        sidebarMode,
        showTree: () => setNavigation("tree"),
        showCollections: () => setNavigation("collections"),
        canReadTasks,
        selectView,
        selectTask,
        returnToCollection: () => change(view, taskId, true),
      }}
    >
      <div className="h-full min-h-0 min-w-0">{children}</div>
      <ConfirmDialog
        open={!!pendingChange}
        onOpenChange={(open) => {
          if (!open) setPendingChange(null);
        }}
        title="Discard unsaved changes?"
        description="Your file edits have not been saved. Discard them and change collection?"
        confirmLabel="Discard and continue"
        variant="destructive"
        onConfirm={() => {
          if (!pendingChange) return;
          const state = useFilesWorkspaceStore.getState();
          const dirty = state.byProjectId[projectId]?.dirtyFileId;
          if (dirty) state.setDirtyFile(projectId, dirty, false);
          change(
            pendingChange.view,
            pendingChange.taskId,
            pendingChange.preserveQuery,
          );
          setPendingChange(null);
        }}
      />
    </WorkspaceContext.Provider>
  );
}
