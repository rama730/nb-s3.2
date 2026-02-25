"use client";

import { useState } from "react";

export function useWorkspaceUiState() {
  const [findOpen, setFindOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState("");
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
    headerSearchOpen,
    setHeaderSearchOpen,
    headerSearchQuery,
    setHeaderSearchQuery,
    recentFileIds,
    setRecentFileIds,
  };
}
