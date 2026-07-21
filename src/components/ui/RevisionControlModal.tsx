"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Info, Edit, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RevisionControlModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  onSelectOption: (choice: { option: "overwrite" | "commit"; comment?: string }) => void;
}

export function RevisionControlModal({
  isOpen,
  onOpenChange,
  fileName,
  onSelectOption,
}: RevisionControlModalProps): React.JSX.Element {
  const [selected, setSelected] = React.useState<"overwrite" | "commit">("commit");
  const [comment, setComment] = React.useState("");

  const handleConfirm = () => {
    onSelectOption({ option: selected, comment: selected === "commit" ? comment : undefined });
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white dark:bg-zinc-950 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-xl">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Confirm Changes Application
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400 dark:text-zinc-500">
            Choose how modifications to <span className="font-mono text-zinc-900 dark:text-zinc-100 font-semibold">{fileName}</span> should be saved.
          </DialogDescription>
        </DialogHeader>

        {/* Options grid */}
        <div className="flex flex-col gap-3 my-4">
          {/* Commit as New Revision */}
          <div
            onClick={() => setSelected("commit")}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              selected === "commit"
                ? "border-indigo-500 bg-indigo-50/20 dark:border-indigo-600 dark:bg-indigo-950/10"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
            }`}
          >
            <div className={`p-1.5 rounded-full ${selected === "commit" ? "bg-indigo-100 dark:bg-indigo-950" : "bg-zinc-100 dark:bg-zinc-900"}`}>
              <FileText className={`h-4 w-4 ${selected === "commit" ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500"}`} />
            </div>
            <div className="flex-1">
              <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Commit as New Revision</h4>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                Creates an incremental version log. Safe for tracking milestones and history.
              </p>
            </div>
          </div>

          {/* Overwrite Active Revision */}
          <div
            onClick={() => setSelected("overwrite")}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              selected === "overwrite"
                ? "border-amber-500 bg-amber-50/20 dark:border-amber-600 dark:bg-amber-950/10"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
            }`}
          >
            <div className={`p-1.5 rounded-full ${selected === "overwrite" ? "bg-amber-100 dark:bg-amber-950" : "bg-zinc-100 dark:bg-zinc-900"}`}>
              <Edit className={`h-4 w-4 ${selected === "overwrite" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500"}`} />
            </div>
            <div className="flex-1">
              <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Apply to Active Revision</h4>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                Directly overwrites current bytes. Recommended for small edits or draft work.
              </p>
            </div>
          </div>
        </div>

        {/* Optional Comment for Commit */}
        {selected === "commit" && (
          <div className="my-3">
            <label htmlFor="commit-comment" className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1">
              Changelog Comment (Optional)
            </label>
            <textarea
              id="commit-comment"
              rows={2}
              maxLength={200}
              placeholder="E.g., Updated section 4 layout improvements..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full text-xs p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none   resize-none"
            />
          </div>
        )}

        <DialogFooter className="mt-6 flex justify-end gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            className={`text-xs font-semibold px-4 py-2 text-white ${
              selected === "commit"
                ? "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                : "bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
            }`}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
