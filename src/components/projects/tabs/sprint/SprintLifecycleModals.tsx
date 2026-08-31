"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  computeSprintStatus,
  type SprintHealthSummary,
  type SprintListItem,
} from "@/lib/projects/sprint-detail";
import { cn } from "@/lib/utils";

type LifecycleAction = "complete" | "archive" | "cancel" | null;
type UnfinishedWorkChoice = "keep" | "backlog" | "next_sprint";

type SprintLifecycleModalsProps = {
  openModal: LifecycleAction;
  selectedSprint: SprintListItem | null;
  sprints: SprintListItem[];
  summary: SprintHealthSummary | null;
  isMutating: boolean;
  onClose: () => void;
  onConfirmComplete: (
    unfinished: UnfinishedWorkChoice,
    nextSprintId: string | null,
  ) => Promise<boolean>;
  onConfirmArchive: () => Promise<boolean>;
  onConfirmCancel: () => Promise<boolean>;
};

const completionOptions: Array<{
  value: UnfinishedWorkChoice;
  title: string;
  description: string;
}> = [
  {
    value: "keep",
    title: "Keep in sprint history",
    description:
      "Close the sprint while retaining unfinished tasks for reporting.",
  },
  {
    value: "backlog",
    title: "Move to backlog",
    description:
      "Remove unfinished tasks from this sprint without assigning a new sprint.",
  },
  {
    value: "next_sprint",
    title: "Move to a Planning Sprint",
    description: "Carry unfinished work into a scheduled or active Sprint.",
  },
];

export function SprintLifecycleModals({
  openModal,
  selectedSprint,
  sprints,
  summary,
  isMutating,
  onClose,
  onConfirmComplete,
  onConfirmArchive,
  onConfirmCancel,
}: SprintLifecycleModalsProps) {
  const [unfinishedChoice, setUnfinishedChoice] =
    useState<UnfinishedWorkChoice>("keep");
  const [nextSprintId, setNextSprintId] = useState("");
  const carryOverSprints = useMemo(
    () =>
      sprints.filter(
        (sprint) =>
          sprint.id !== selectedSprint?.id &&
          ["planning", "active"].includes(computeSprintStatus(sprint)),
      ),
    [selectedSprint?.id, sprints],
  );

  useEffect(() => {
    if (!openModal) return;
    setUnfinishedChoice("keep");
    setNextSprintId("");
  }, [openModal, selectedSprint?.id]);

  if (!openModal || !selectedSprint) return null;

  const title =
    openModal === "complete"
      ? "Complete sprint"
      : openModal === "archive"
        ? "Archive sprint"
        : "Cancel sprint";
  const description =
    openModal === "complete"
      ? `Choose what happens to unfinished work in ${selectedSprint.name}.`
      : openModal === "archive"
        ? `Archive ${selectedSprint.name}. Its history stays available to the team.`
        : `Cancel ${selectedSprint.name}. Unfinished work remains visible in the backlog.`;
  const remainingTasks = Math.max(
    (summary?.totalTasks ?? 0) - (summary?.completedTasks ?? 0),
    0,
  );
  const requiresTargetSprint = unfinishedChoice === "next_sprint";

  const close = () => {
    if (!isMutating) onClose();
  };

  const submit = async () => {
    if (openModal === "complete" && requiresTargetSprint && !nextSprintId) {
      toast.error("Choose a Sprint for the unfinished work.");
      return;
    }

    const succeeded =
      openModal === "complete"
        ? await onConfirmComplete(
            unfinishedChoice,
            requiresTargetSprint ? nextSprintId : null,
          )
        : openModal === "archive"
          ? await onConfirmArchive()
          : await onConfirmCancel();
    if (succeeded) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-lg"
        showCloseButton={!isMutating}
        onEscapeKeyDown={(event) => {
          if (isMutating) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isMutating) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {openModal === "complete" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {summary?.completedTasks ?? 0} of {summary?.totalTasks ?? 0} task
              {(summary?.totalTasks ?? 0) === 1 ? "" : "s"} completed
              {remainingTasks > 0 ? ` · ${remainingTasks} remaining` : ""}
            </p>
            <div
              aria-label="Unfinished task handling"
              className="space-y-2"
              role="radiogroup"
            >
              {completionOptions.map((option) => (
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
                    unfinishedChoice === option.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                  key={option.value}
                >
                  <input
                    checked={unfinishedChoice === option.value}
                    className="mt-1"
                    disabled={isMutating}
                    name="unfinished-work"
                    onChange={() => setUnfinishedChoice(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      {option.title}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {requiresTargetSprint ? (
              <label className="block space-y-2 text-sm font-medium text-foreground">
                Destination Sprint
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={isMutating || carryOverSprints.length === 0}
                  onChange={(event) => setNextSprintId(event.target.value)}
                  value={nextSprintId}
                >
                  <option value="">
                    {carryOverSprints.length === 0
                      ? "No Planning or active Sprint available"
                      : "Select a Sprint"}
                  </option>
                  {carryOverSprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.name} ({sprint.code})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <button
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isMutating}
            onClick={close}
            type="button"
          >
            Cancel
          </button>
          <button
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50",
              openModal === "cancel"
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-primary hover:bg-primary/90",
            )}
            disabled={
              isMutating ||
              (requiresTargetSprint &&
                (!nextSprintId || carryOverSprints.length === 0))
            }
            onClick={() => void submit()}
            type="button"
          >
            {isMutating
              ? "Saving…"
              : openModal === "complete"
                ? "Complete sprint"
                : openModal === "archive"
                  ? "Archive sprint"
                  : "Cancel sprint"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
