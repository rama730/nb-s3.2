"use client";

import { useState } from "react";

export function useWorkspaceUiState() {
  const [findOpen, setFindOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [recentFileIds, setRecentFileIds] = useState<string[]>([]);

  return {
    findOpen,
    setFindOpen,
    quickOpenOpen,
    setQuickOpenOpen,
    quickOpenQuery,
    setQuickOpenQuery,
    commandOpen,
    setCommandOpen,
    commandQuery,
    setCommandQuery,
    recentFileIds,
    setRecentFileIds,
  };
}
