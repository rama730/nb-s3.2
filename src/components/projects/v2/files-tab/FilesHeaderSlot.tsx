"use client";

import React, { createContext, useContext } from "react";
import { createPortal } from "react-dom";

// Keep leaf controls independent of the header's navigation/search imports.
export const FilesHeaderContext = createContext<{
  actions: HTMLDivElement | null;
  status: HTMLDivElement | null;
  canOpenGitHub: boolean;
} | null>(null);

export function FilesHeaderSlot({
  children,
  slot = "actions",
}: {
  children: React.ReactNode;
  slot?: "actions" | "status";
}) {
  const header = useContext(FilesHeaderContext);
  if (!header) return <>{children}</>;
  return header[slot] ? createPortal(children, header[slot]) : null;
}
