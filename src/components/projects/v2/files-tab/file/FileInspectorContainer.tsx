"use client";
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** A single inspector: inline on desktop, focus-contained drawer on small screens. */
export function FileInspectorContainer({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => setCompact(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  if (compact)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          presentation="right-drawer"
          showCloseButton={false}
          className="w-[min(24rem,100vw)] gap-0 overflow-hidden p-0"
          data-testid={testId}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {children}
        </DialogContent>
      </Dialog>
    );
  return (
    <aside
      aria-label={title}
      data-testid={testId}
      className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      {children}
    </aside>
  );
}
