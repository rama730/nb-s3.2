"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { UploadCollisionSummary } from "@/app/actions/files/mutations";

type Choice = "skip" | "keep_both" | "cancel";

/** A bounded upload decision, using the same accessible dialog as file actions. */
export function useUploadCollisionDecision() {
  const [pending, setPending] = useState<{ summary: UploadCollisionSummary; copies: boolean } | null>(null);
  const resolveRef = useRef<((choice: Choice) => void) | null>(null);
  const finish = useCallback((choice: Choice) => {
    resolveRef.current?.(choice);
    resolveRef.current = null;
    setPending(null);
  }, []);
  useEffect(() => () => { resolveRef.current?.("cancel"); }, []);
  const chooseUploadCollision = useCallback((summary: UploadCollisionSummary, copies = false): Promise<Choice> => {
    if (!summary.existingFiles.length && !summary.existingFolders.length) return Promise.resolve("skip");
    resolveRef.current?.("cancel");
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setPending({ summary, copies });
    });
  }, []);
  const uploadCollisionDialog = (
    <Dialog open={!!pending} onOpenChange={open => { if (!open) finish("cancel"); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Some names already exist</DialogTitle>
          <DialogDescription>
            {pending?.copies
              ? "Keep existing items and upload renamed copies, or skip matching names. Nothing will be overwritten."
              : "Existing folders will be reused and matching files skipped. Nothing will be overwritten."}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 overflow-y-auto text-sm text-zinc-600 dark:text-zinc-300">
          {[...(pending?.summary.existingFiles ?? []), ...(pending?.summary.existingFolders ?? [])].slice(0, 20).map(name => <li key={name} className="truncate py-1" title={name}>{name}</li>)}
        </ul>
        <p className="text-xs text-zinc-500">To revise an existing file, use its “Upload revision” action instead.</p>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => finish("cancel")}>Cancel</Button>
          <Button variant="outline" onClick={() => finish("skip")}>{pending?.copies ? "Skip existing" : "Continue"}</Button>
          {pending?.copies && <Button onClick={() => finish("keep_both")}>Keep both</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { chooseUploadCollision, uploadCollisionDialog };
}
