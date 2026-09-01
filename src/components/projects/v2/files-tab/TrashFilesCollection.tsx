"use client";
import { FilesWorkspaceMenu } from "./FilesWorkspaceHeader";
import React, { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getTrashPage, restoreNode } from "@/app/actions/files/mutations";
import {
  getPermanentDeleteImpact,
  permanentlyDeleteTrashedNode,
} from "@/app/actions/files/trash";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useFilesWorkspaceView } from "./FilesWorkspaceViews";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { formatRelativeTime } from "./folder/format";
import { FileIcon } from "../explorer/FileIcons";

function originalLocation(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "Project files";
  return `/${parts.slice(0, -1).join("/")}`;
}

export function TrashFilesCollection({ projectId }: { projectId: string }) {
  const { query } = useFilesWorkspaceView()!;
  const { canEdit, canManageFiles } = useFilesTabRole();
  const search = query;
  const [busy, setBusy] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<
    | ({ id: string } & Awaited<ReturnType<typeof getPermanentDeleteImpact>>)
    | null
  >(null);
  const client = useQueryClient();
  const result = useInfiniteQuery({
    queryKey: ["files-trash", projectId, search],
    enabled: canEdit,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getTrashPage(projectId, search, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  function reconcile() {
    // Mutation success is distinct from a later refresh failure.
    void client.invalidateQueries({ queryKey: ["files-trash", projectId] });
    void client.invalidateQueries({ queryKey: ["files-directory", projectId] });
    window.dispatchEvent(
      new CustomEvent("project:task-files-changed", { detail: { projectId } }),
    );
  }
  async function restore(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await restoreNode(id, projectId);
      toast.success("Restored to its original location");
      reconcile();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not restore file",
      );
    } finally {
      setBusy(null);
    }
  }
  async function reviewDeletion(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      setDeletion({ id, ...(await getPermanentDeleteImpact(projectId, id)) });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not review deletion",
      );
    } finally {
      setBusy(null);
    }
  }
  async function confirmDeletion() {
    if (!deletion || busy) return;
    setBusy(deletion.id);
    try {
      const response = await permanentlyDeleteTrashedNode(
        projectId,
        deletion.id,
        deletion.fingerprint,
      );
      if (response.status === "pending")
        toast.warning(
          "Deletion is pending storage cleanup. It remains in Trash and will be retried automatically; you can also retry from its menu.",
        );
      else {
        for (const id of response.deletedIds)
          useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, id);
        toast.success("Permanently deleted. This cannot be undone.");
      }
      setDeletion(null);
      reconcile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deletion failed");
    } finally {
      setBusy(null);
    }
  }
  if (!canEdit)
    return <p className="p-6">You do not have permission to view trash.</p>;
  const nodes = result.data?.pages.flatMap((page) => page.nodes) ?? [];
  return (
    <section aria-label="Trash" className="h-full min-w-0 overflow-y-auto p-3">
      <FilesWorkspaceMenu projectId={projectId} />
      {result.isError && (
        <p role="alert" className="p-3 text-sm">
          Could not update Trash.{" "}
          <button className="underline" onClick={() => void result.refetch()}>
            Retry
          </button>
        </p>
      )}
      {result.isPending ? (
        <p role="status">Loading trash…</p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {nodes.map((node) => (
              <li
                key={node.id}
                className="flex min-h-14 items-center gap-3 px-2 py-1"
              >
                <FileIcon
                  name={node.name}
                  isFolder={node.type === "folder"}
                  className="size-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{node.name}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {node.metadata?.permanentDeleteRoot
                      ? "Permanent deletion pending"
                      : `Deleted ${formatRelativeTime(node.deletedAt)}${node.deletedByName ? ` by ${node.deletedByName}` : ""}`}
                  </p>
                  <p
                    className="truncate text-xs text-zinc-500"
                    title={`Original location: ${originalLocation(node.path)}`}
                  >
                    Original location: {originalLocation(node.path)}
                  </p>
                </div>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={!!busy}
                      aria-label={`Actions for ${node.name}`}
                      className="flex size-10 shrink-0 items-center justify-center rounded hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:hover:bg-zinc-800"
                    >
                      <MoreHorizontal aria-hidden="true" className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!!node.metadata?.permanentDeleteRoot}
                      onSelect={() => void restore(node.id)}
                    >
                      <RotateCcw className="mr-2 size-4" />
                      Restore
                    </DropdownMenuItem>
                    {canManageFiles && (
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        disabled={
                          !!node.metadata?.permanentDeleteRoot &&
                          node.metadata.permanentDeleteRoot !== node.id
                        }
                        onSelect={() => void reviewDeletion(node.id)}
                      >
                        <Trash2 className="mr-2 size-4" />
                        {node.metadata?.permanentDeleteRoot
                          ? "Retry permanent deletion…"
                          : "Delete permanently…"}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
          {!nodes.length && !result.isError && (
            <p className="py-8 text-sm text-zinc-500">
              {search
                ? "No deleted items match your search."
                : "Trash is empty."}
            </p>
          )}
          {result.hasNextPage && (
            <button
              type="button"
              disabled={result.isFetchingNextPage}
              onClick={() => void result.fetchNextPage()}
              className="mt-4 min-h-10 rounded border px-4"
            >
              {result.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open && !busy) setDeletion(null);
        }}
        title={`Permanently delete “${deletion?.name ?? ""}”?`}
        description="This cannot be undone. Shared storage objects used by other files are retained. GitHub is not modified."
        confirmLabel={busy ? "Deleting…" : "Delete permanently"}
        variant="destructive"
        loading={!!busy}
        autoCloseOnConfirm={false}
        onConfirm={confirmDeletion}
      >
        {deletion && (
          <p className="text-sm">
            {deletion.items} item(s), {deletion.versions} stored version(s), and{" "}
            {deletion.taskLinks} task link(s) will be removed.{" "}
            {deletion.documentLinks} linked document(s) will be disconnected
            from the file.
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
