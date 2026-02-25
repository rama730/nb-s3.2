import { useEffect } from "react";

interface UseWorkspaceKeyboardOptions {
  onQuickOpen: () => void;
  onCommandPalette: () => void;
  onFindInProject: () => void;
  quickOpenOpen: boolean;
  commandOpen: boolean;
  onCloseQuickOpen: () => void;
  onCloseCommand: () => void;
}

export function useWorkspaceKeyboard({
  onQuickOpen,
  onCommandPalette,
  onFindInProject,
  quickOpenOpen,
  commandOpen,
  onCloseQuickOpen,
  onCloseCommand,
}: UseWorkspaceKeyboardOptions) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onQuickOpen();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onCommandPalette();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onFindInProject();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onQuickOpen, onCommandPalette, onFindInProject]);

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
