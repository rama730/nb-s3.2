import { useEffect, useRef } from "react";

const INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
].join(",");

function isInteractiveElement(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return !!target.closest(INTERACTIVE_SELECTOR);
}

function isWorkspaceFileFocused(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.closest("[data-workspace-file-item='true']")) return true;
  return !!target.closest("[role='tree'][aria-label='File explorer']");
}

interface UseWorkspaceKeyboardOptions {
  onQuickOpen: () => void;
  onCommandPalette: () => void;
  onFindInProject: () => void;
  onToggleSidebar: () => void;
  onToggleZenMode: () => void;
  onQuickSwitch: () => void;
  quickOpenOpen: boolean;
  commandOpen: boolean;
  onCloseQuickOpen: () => void;
  onCloseCommand: () => void;
  onNewFile: () => void;
  onSave: () => void;
  onDelete: () => void;
  onQuickLook: () => void;
  onShowShortcuts: () => void;
}

export function useWorkspaceKeyboard({
  onQuickOpen,
  onCommandPalette,
  onFindInProject,
  onToggleSidebar,
  onToggleZenMode,
  onQuickSwitch,
  quickOpenOpen,
  commandOpen,
  onCloseQuickOpen,
  onCloseCommand,
  onNewFile,
  onSave,
  onDelete,
  onQuickLook,
  onShowShortcuts,
}: UseWorkspaceKeyboardOptions) {
  // Track Cmd+K chord for zen mode (Cmd+K then Z)
  const chordRef = useRef(false);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const activeElement = document.activeElement as HTMLElement | null;
      const focusTarget = activeElement ?? target;
      const isEditable = isInteractiveElement(focusTarget);

      if (isEditable) {
        chordRef.current = false;
        if (chordTimerRef.current) { clearTimeout(chordTimerRef.current); chordTimerRef.current = null; }
        return;
      }

      // --- Chord: Cmd+K then Z → zen mode ---
      if (chordRef.current && e.key.toLowerCase() === "z") {
        e.preventDefault();
        chordRef.current = false;
        if (chordTimerRef.current) { clearTimeout(chordTimerRef.current); chordTimerRef.current = null; }
        onToggleZenMode();
        return;
      }
      chordRef.current = false;
      if (chordTimerRef.current) { clearTimeout(chordTimerRef.current); chordTimerRef.current = null; }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        chordRef.current = true;
        chordTimerRef.current = setTimeout(() => { chordRef.current = false; chordTimerRef.current = null; }, 1000);
        return;
      }

      // Cmd+N -> New File
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNewFile();
        return;
      }
      // Cmd+S -> Save
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave();
        return;
      }
      // Cmd+Backspace -> Delete
      if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
        e.preventDefault();
        onDelete();
        return;
      }
      // Space -> Quick Look
      if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (isInteractiveElement(focusTarget)) return;
        if (!isWorkspaceFileFocused(focusTarget)) return;
        e.preventDefault();
        onQuickLook();
        return;
      }

      // Cmd+P → quick open
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onQuickOpen();
        return;
      }
      // Cmd+Shift+P → command palette
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onCommandPalette();
        return;
      }
      // Cmd+Shift+F → find in project
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onFindInProject();
        return;
      }
      // Cmd+B → toggle sidebar
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        onToggleSidebar();
        return;
      }
      // Ctrl+Tab → quick switch recent file
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
        e.preventDefault();
        onQuickSwitch();
        return;
      }
      // Cmd+/ → show shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        onShowShortcuts();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (chordTimerRef.current) { clearTimeout(chordTimerRef.current); chordTimerRef.current = null; }
    };
  }, [
    onQuickOpen,
    onCommandPalette,
    onFindInProject,
    onToggleSidebar,
    onToggleZenMode,
    onQuickSwitch,
    onNewFile,
    onSave,
    onDelete,
    onQuickLook,
    onShowShortcuts
  ]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (quickOpenOpen) onCloseQuickOpen();
      if (commandOpen) onCloseCommand();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [commandOpen, quickOpenOpen, onCloseQuickOpen, onCloseCommand]);
}
