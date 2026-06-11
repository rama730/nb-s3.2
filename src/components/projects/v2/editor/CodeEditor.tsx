"use client";

import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { cn } from "@/lib/utils";
import { EditorSelection, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { search, searchKeymap } from "@codemirror/search";
import { useTheme } from "@/components/providers/theme-provider";
import type { EditorSymbol } from "@/stores/files/types";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";

type ThemeMode = "dark" | "light";

export interface CodeEditorProps {
  filename: string;
  value: string;
  onChange: (value: string) => void;
  /** Optional explicit theme override. When omitted, reads from the app theme provider. */
  theme?: ThemeMode;
  isActive?: boolean;
  readOnly?: boolean;
  lineNumbers?: boolean;
  wordWrap?: boolean;
  fontSize?: number;
  minimapEnabled?: boolean;
  modelPath?: string;
  onSymbolsChange?: (symbols: EditorSymbol[]) => void;
  scrollToLine?: number | null;
  onCursorChange?: (line: number) => void;
  onCursorActivity?: (position: {
    line: number;
    column: number;
    selectionStart: number;
    selectionEnd: number;
  }) => void;
  onScrollActivity?: (position: {
    ratio: number;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  }) => void;
  selectionRange?: {
    from: number;
    to: number;
    token: number;
  } | null;
  sourceHighlightRange?: {
    from: number;
    to: number;
    token: number;
  } | null;
  scrollRatioTarget?: {
    ratio: number;
    token: number;
  } | null;
  extraExtensions?: Extension[];
  gitStatus?: "modified" | "added" | "deleted" | null;
  tabId?: string;
  onFileDrop?: (files: File[]) => void;
  isCollaborative?: boolean;
  ydoc?: Y.Doc;
  provider?: any;
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
  theme: themeProp,
  isActive = true,
  readOnly = false,
  lineNumbers = true,
  wordWrap = true,
  fontSize = 14,
  minimapEnabled = false,
  scrollToLine,
  onCursorChange,
  onCursorActivity,
  onScrollActivity,
  selectionRange,
  sourceHighlightRange,
  scrollRatioTarget,
  extraExtensions = [],
  gitStatus,
  tabId,
  onFileDrop,
  isCollaborative = false,
  ydoc,
  provider,
}: CodeEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const minimapSupported = false;

  // Read from the app theme provider; use explicit prop as override if provided.
  const { resolvedTheme } = useTheme();
  const theme: ThemeMode = themeProp ?? resolvedTheme;

  const [initialValue, setInitialValue] = useState(value);
  const [lastTabKey, setLastTabKey] = useState(tabId + ":" + filename);

  if (lastTabKey !== tabId + ":" + filename) {
    setLastTabKey(tabId + ":" + filename);
    setInitialValue(value);
  }

  const effectiveValue = isCollaborative ? undefined : value;

  const dispatchCursorMoved = useCallback(
    (view: EditorView, targetTabId?: string) => {
      const pos = view.state.selection.main.head;
      const selectionStart = view.state.selection.main.from;
      const selectionEnd = view.state.selection.main.to;
      const line = view.state.doc.lineAt(pos);
      const lineNumber = line.number;
      const column = pos - line.from + 1;

      if (onCursorChange) {
        onCursorChange(lineNumber);
      }
      if (onCursorActivity) {
        onCursorActivity({
          line: lineNumber,
          column,
          selectionStart,
          selectionEnd,
        });
      }

      if (targetTabId) {
        window.dispatchEvent(
          new CustomEvent("cursor-moved", {
            detail: { line: lineNumber, column, tabId: targetTabId },
          })
        );
      }
    },
    [onCursorActivity, onCursorChange]
  );

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

  useEffect(() => {
    if (!selectionRange || !editorRef.current?.view) return;
    const view = editorRef.current.view;
    const docLength = view.state.doc.length;
    const from = Math.max(0, Math.min(selectionRange.from, docLength));
    const to = Math.max(from, Math.min(selectionRange.to, docLength));
    view.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    view.focus();
  }, [selectionRange]);

  useEffect(() => {
    if (!scrollRatioTarget || !editorRef.current?.view) return;
    const view = editorRef.current.view;
    const scrollDOM = view.scrollDOM;
    const maxScrollTop = Math.max(0, scrollDOM.scrollHeight - scrollDOM.clientHeight);
    scrollDOM.scrollTo({
      top: maxScrollTop * Math.max(0, Math.min(1, scrollRatioTarget.ratio)),
      behavior: "auto",
    });
  }, [scrollRatioTarget]);

  const sourceHighlightExtensions = useMemo<Extension[]>(() => {
    if (!sourceHighlightRange) return [];
    const docLength = value.length;
    const from = Math.max(0, Math.min(sourceHighlightRange.from, docLength));
    const to = Math.max(from, Math.min(sourceHighlightRange.to, docLength));
    const safeTo = to > from ? to : Math.min(docLength, from + 1);
    if (safeTo <= from) return [];
    return [
      EditorView.decorations.of(Decoration.set([
        Decoration.mark({ class: "cm-readme-source-highlight" }).range(from, safeTo),
      ])),
      EditorView.theme({
        ".cm-readme-source-highlight": {
          backgroundColor: "rgba(59, 130, 246, 0.18)",
          boxShadow: "0 0 0 2px rgba(59, 130, 246, 0.28)",
          borderRadius: "4px",
          transition: "background-color 160ms ease, box-shadow 160ms ease",
        },
      }),
    ];
  }, [sourceHighlightRange, value.length]);

  useEffect(() => {
    if (!isEditorReady || !editorRef.current?.view || !onScrollActivity) return undefined;
    const scrollDOM = editorRef.current.view.scrollDOM;
    let frameId = 0;
    const emitScrollActivity = () => {
      frameId = 0;
      const maxScrollTop = Math.max(0, scrollDOM.scrollHeight - scrollDOM.clientHeight);
      onScrollActivity({
        ratio: maxScrollTop > 0 ? scrollDOM.scrollTop / maxScrollTop : 0,
        scrollTop: scrollDOM.scrollTop,
        scrollHeight: scrollDOM.scrollHeight,
        clientHeight: scrollDOM.clientHeight,
      });
    };
    const handleScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(emitScrollActivity);
    };
    scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      scrollDOM.removeEventListener("scroll", handleScroll);
    };
  }, [isEditorReady, onScrollActivity]);

  const extensions = useMemo(() => {
    const minimapExtensions: Extension[] = [];
    // Temporarily disabled: this plugin is causing intermittent DOM hierarchy
    // insertBefore crashes on mount in the current runtime stack.
    if (minimapEnabled && minimapSupported) {
      // No-op placeholder until minimap integration is reintroduced safely.
    }

    const collabExtensions = (isCollaborative && ydoc && provider)
      ? [yCollab(ydoc.getText('markdown'), provider.awareness)]
      : [];

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
          dispatchCursorMoved(update.view, tabId);
        }
      }),
      ...collabExtensions,
      ...extraExtensions,
      ...sourceHighlightExtensions,
    ];
  }, [langExtension, fontSize, minimapEnabled, readOnly, wordWrap, tabId, dispatchCursorMoved, extraExtensions, sourceHighlightExtensions, isCollaborative, ydoc, provider]);

  // Dispatch initial cursor position when editor is ready and tab changes
  useEffect(() => {
    if (!isEditorReady || !editorRef.current?.view || !tabId) return;
    const view = editorRef.current.view;
    dispatchCursorMoved(view, tabId);
  }, [tabId, isEditorReady, dispatchCursorMoved]);

  useEffect(() => {
    if (!isActive || !isEditorReady || !editorRef.current?.view) return;
    const view = editorRef.current.view;
    let frameId = 0;
    frameId = window.requestAnimationFrame(() => {
      view.requestMeasure({
        read: () => view.dom.getBoundingClientRect(),
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [filename, isActive, isEditorReady, langExtension]);

  return (
    <div
      className="relative h-full min-h-0 w-full flex flex-row overflow-hidden"
      onDragOver={(e) => {
        if (!onFileDrop) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!onFileDrop) return;
        e.preventDefault();
        e.stopPropagation();
        // Only set dragging to false if we are actually leaving the container
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        if (!onFileDrop) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onFileDrop(Array.from(e.dataTransfer.files));
        }
      }}
    >
      {isDragging && onFileDrop && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-500/10 backdrop-blur-[2px] border-2 border-dashed border-blue-500 rounded-lg pointer-events-none">
          <div className="flex flex-col items-center justify-center bg-white dark:bg-zinc-900 rounded-xl shadow-2xl p-6 text-center">
            <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 text-blue-600 dark:text-blue-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Drop files here</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Images, videos, or documents</p>
          </div>
        </div>
      )}
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
        onCreateEditor={(view) => {
          setIsEditorReady(true);
        }}
        value={effectiveValue}
        onChange={(nextValue) => {
          if (!isCollaborative) {
            onChange(nextValue);
          }
        }}
        theme={theme === "dark" ? oneDark : undefined}
        height="100%"
        width="100%"
        className="h-full min-h-0 flex-1 text-base overflow-hidden"
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
