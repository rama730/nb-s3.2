"use client";

import React, { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
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
}

function getExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "js":
    case "jsx":
      return javascript({ typescript: false, jsx: true });
    case "json":
      return json();
    case "css":
      return css();
    case "html":
      return html();
    case "md":
      return markdown();
    case "sql":
      return sql();
    case "py":
      return python();
    default:
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
}: CodeEditorProps) {
  const extensions = useMemo(() => {
    const lang = getExtension(filename);
    return [
      ...(lang ? [lang] : []),
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
  }, [filename, fontSize, minimapEnabled, readOnly, wordWrap]);

  return (
    <CodeMirror
      value={value}
      onChange={(nextValue) => onChange(nextValue)}
      theme={theme === "dark" ? oneDark : undefined}
      height="100%"
      width="100%"
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

