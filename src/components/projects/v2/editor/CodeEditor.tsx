"use client";

import React, { useMemo, useRef, useEffect, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { cn } from "@/lib/utils";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { search, searchKeymap } from "@codemirror/search";
import type { EditorSymbol } from "@/stores/files/types";

type ThemeMode = "dark" | "light";

export interface CodeEditorProps {
  filename: string;
  value: string;
  onChange: (value: string) => void;
  theme: ThemeMode;
  readOnly?: boolean;
  lineNumbers?: boolean;
  wordWrap?: boolean;
  fontSize?: number;
  minimapEnabled?: boolean;
  modelPath?: string;
  onSymbolsChange?: (symbols: EditorSymbol[]) => void;
  scrollToLine?: number | null;
  onCursorChange?: (line: number) => void;
  gitStatus?: "modified" | "added" | "deleted" | null;
  tabId?: string;
}

function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

async function loadLanguageExtension(ext: string): Promise<Extension | null> {
  try {
    switch (ext) {
      case "ts": case "tsx": case "js": case "jsx":
        return (await import("@codemirror/lang-javascript")).javascript({
          jsx: ext.includes("x"),
          typescript: ext.startsWith("t"),
        });
      case "py":
        return (await import("@codemirror/lang-python")).python();
      case "sql":
        return (await import("@codemirror/lang-sql")).sql();
      case "css":
        return (await import("@codemirror/lang-css")).css();
      case "html":
        return (await import("@codemirror/lang-html")).html();
      case "md": case "mdx":
        return (await import("@codemirror/lang-markdown")).markdown();
      case "json":
        return (await import("@codemirror/lang-json")).json();
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export default function CodeEditor({
  filename,
  value,
  onChange,
  theme,
  readOnly = false,
  lineNumbers = true,
  wordWrap = true,
  fontSize = 14,
  minimapEnabled = false,
  scrollToLine,
  onCursorChange,
  gitStatus,
  tabId,
}: CodeEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);
  const minimapSupported = false;

  const ext = getFileExtension(filename);
  useEffect(() => {
    let cancelled = false;
    setLangExtension(null);
    loadLanguageExtension(ext).then((loaded) => {
      if (!cancelled) setLangExtension(loaded);
    });
    return () => { cancelled = true; };
  }, [ext]);

  useEffect(() => {
    if (!scrollToLine || !editorRef.current?.view) return;
    const view = editorRef.current.view;
    const line = view.state.doc.line(Math.min(scrollToLine, view.state.doc.lines));
    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
  }, [scrollToLine]);

  const extensions = useMemo(() => {
    const minimapExtensions: Extension[] = [];
    // Temporarily disabled: this plugin is causing intermittent DOM hierarchy
    // insertBefore crashes on mount in the current runtime stack.
    if (minimapEnabled && minimapSupported) {
      // No-op placeholder until minimap integration is reintroduced safely.
    }

    return [
      ...(langExtension ? [langExtension] : []),
      ...(wordWrap ? [EditorView.lineWrapping] : []),
      EditorView.editable.of(!readOnly),
      search({ top: true }),
      keymap.of(searchKeymap),
      EditorView.theme({
        "&": { fontSize: `${fontSize}px` },
      }),
      ...minimapExtensions,
      // Cursor position tracking for sticky scroll
      EditorView.updateListener.of((update) => {
        if (update.selectionSet) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          const lineNumber = line.number;
          const column = pos - line.from + 1;

          if (onCursorChange) {
            onCursorChange(lineNumber);
          }

          // Phase 6e: Transient status bar update via custom event
          window.dispatchEvent(
            new CustomEvent("cursor-moved", {
              detail: { line: lineNumber, column, tabId },
            })
          );
        }
      }),
    ];
  }, [langExtension, fontSize, minimapEnabled, onCursorChange, readOnly, wordWrap, tabId]);

  // Phase 6e: Dispatch initial position on mount or tab change
  useEffect(() => {
    if (!editorRef.current?.view || !tabId) return;
    const view = editorRef.current.view;
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    window.dispatchEvent(
      new CustomEvent("cursor-moved", {
        detail: { line: line.number, column: pos - line.from + 1, tabId },
      })
    );
  }, [tabId, langExtension]); // Re-run when lang loads as it affects view ready state

  return (
    <div className="relative h-full w-full flex flex-row overflow-hidden">
      {gitStatus && (
        <div 
          className={cn(
            "w-1 h-full shrink-0 transition-colors duration-300",
            gitStatus === "added" && "bg-emerald-500/80",
            gitStatus === "modified" && "bg-blue-500/80",
            gitStatus === "deleted" && "bg-red-500/80"
          )} 
          title={`Git Status: ${gitStatus}`}
        />
      )}
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={(nextValue) => onChange(nextValue)}
        theme={theme === "dark" ? oneDark : undefined}
        height="100%"
        width="100%"
        className="h-full flex-1 text-base overflow-hidden"
        extensions={extensions}
        basicSetup={{
          lineNumbers,
          foldGutter: true,
          highlightActiveLine: true,
          bracketMatching: true,
          autocompletion: true,
          closeBrackets: true,
          highlightSelectionMatches: true,
        }}
      />
    </div>
  );
}
