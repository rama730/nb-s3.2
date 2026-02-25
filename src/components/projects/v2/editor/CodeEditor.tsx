"use client";

import React, { useMemo, useRef, useEffect, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { search, searchKeymap } from "@codemirror/search";
import { showMinimap } from "@replit/codemirror-minimap";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSymbolsChange?: (symbols: any[]) => void;
  scrollToLine?: number | null;
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
}: CodeEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);

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
    return [
      ...(langExtension ? [langExtension] : []),
      ...(wordWrap ? [EditorView.lineWrapping] : []),
      EditorView.editable.of(!readOnly),
      search({ top: true }),
      keymap.of(searchKeymap),
      EditorView.theme({
        "&": { fontSize: `${fontSize}px` },
      }),
      ...(minimapEnabled
        ? [
            showMinimap.of({
              create: (text) => text,
              displayText: "characters",
            }),
          ]
        : []),
    ];
  }, [langExtension, fontSize, minimapEnabled, readOnly, wordWrap]);

  return (
    <CodeMirror
      ref={editorRef}
      value={value}
      onChange={(nextValue) => onChange(nextValue)}
      theme={theme === "dark" ? oneDark : undefined}
      height="100%"
      width="100%"
      className="h-full text-base"
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
  );
}

