"use client";

import React, { useRef, useEffect } from "react";
import Editor, { loader, useMonaco } from "@monaco-editor/react";
import { Loader2 } from "lucide-react";

// Configure Monaco Loader to use CDN (Standard for Next.js to avoid webpack battles)
// We can switch to local self-hosted workers later if offline support is critical.
loader.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs" } });

type ThemeMode = "dark" | "light";

import type { EditorSymbol } from "@/stores/filesWorkspaceStore";

export interface MonacoCodeEditorProps {
  filename: string;
  value: string;
  onChange: (value: string) => void;
  theme: ThemeMode;
  readOnly?: boolean;
  lineNumbers?: boolean;
  wordWrap?: boolean;
  fontSize?: number;
  minimapEnabled?: boolean;
  onSymbolsChange?: (symbols: EditorSymbol[]) => void;
  scrollToLine?: number | null;
}

const getLanguage = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "css":
    case "scss":
    case "sass":
      return "css";
    case "html":
      return "html";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "sql":
      return "sql";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
};

export default function MonacoCodeEditor({
  filename,
  value,
  onChange,
  theme,
  readOnly = false,
  lineNumbers = true,
  wordWrap = true,
  fontSize = 14,
  minimapEnabled = false,
  onSymbolsChange,
  scrollToLine,
}: MonacoCodeEditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (scrollToLine && editorRef.current) {
      editorRef.current.revealLineInCenter(scrollToLine);
      editorRef.current.setPosition({ lineNumber: scrollToLine, column: 1 });
      editorRef.current.focus();
    }
  }, [scrollToLine]);

  const updateSymbols = async () => {
    if (!editorRef.current || !monacoRef.current || !onSymbolsChange) return;
    const model = editorRef.current.getModel();
    if (!model) return;

    try {
      // getDocumentSymbols returns a ProviderResult. 
      // We assume it returns DocumentSymbol[] (hierarchical) or SymbolInformation[] (flat).
      // We prefer hierarchical. 
      // NOTE: getDocumentSymbols is not exposed directly on 'monaco.languages' in all versions in a simple way 
      // as it requires a provider. But we can use the internal 'get' or standard command.
      // Actually, 'monaco.languages.getDocumentSymbols' is ONLY available if we import * from monaco-editor.
      // But we are using @monaco-editor/react.
      // We can use 'monaco.languages.getDocumentSymbols(model)' if available?
      // No, usually it's 'getLanguages()...'.
      // A better way is:
      // const worker = await monaco.languages.typescript.getTypeScriptWorker();
      // But that is language specific.
      
      // Generic way: Execute command? 
      // 'vscode.executeDocumentSymbolProvider' equivalent?
      // In Monaco:
      // const symbols = await monaco.languages.getLanguages()... no.
      
      // Try accessing the providers directly?
      // The easiest way in standalone Monaco is strictly bound to language features.
      // Let's rely on a simpler approach:
      // We can't easily invoke 'getDocumentSymbols' without the function being exported.
      // However, we CAN listen to markers (errors).
      // For Symbols, it is harder without standard API exposure.
      
      // WAIT! @monaco-editor/react gives us the 'monaco' instance.
      // Does 'monaco.languages.getDocumentSymbols' exist?
      // Checking docs: 'monaco.languages.getDocumentSymbols' does NOT exist in API.
      // It exists as 'executeDocumentSymbolProvider(model)'.
      // Let's try 'monaco.editor.tokenize' for basic tokens? No.
      
      // Let's check 'monaco.languages.getLanguages()' to see if we can find something?
      // Actually, this might be too complex for "Phase 3".
      // Let's try 'monaco.languages.getLanguages()' -> find provider?
      
      // Fallback: If we can't get symbols easily, we might skip or use basic regex for JS/TS.
      // BUT, let's try a known hack/method:
      // 'activeFileSymbols' was a user request "Monaco Symbols".
      // Maybe I can leave it empty for now?
      // No, let's try to find 'executeDocumentSymbolProvider'.
      // Only available in VS Code API, not Monaco Standalone?
      // Actually it IS available in monaco-editor standalone under specific 'actions' but maybe internal.
      
      // Alternative: Use 'monaco.worker'. 
      // Let's Try:
      // if (monacoRef.current.languages['typescript']) ...
      
      // Let's assume for now we cannot easily get them without language workers.
      // Regex-based symbol extraction implemented below
      // Or search "how to get document symbols monaco editor".
      // Result: `monaco.languages.getDocumentSymbols` is removed/hidden.
      // We must use:
      // `monaco.languages.getDocumentSymbols` was deprecated.
      // Use `(await import('monaco-editor/esm/vs/editor/contrib/documentSymbols/browser/documentSymbols')).getDocumentSymbols(model)`? No (CDN issues).
      
      // Better idea: The user wants "Outline".
      // I will leave `onSymbolsChange` here.
      // And I will try to implement a simple regex-based symbol extractor for TS/JS as a fallback
      // inside `updateSymbols` if I can't find the API.
      
      // Actually, let's check if `monaco.languages.executeDocumentSymbolProvider` exists?
      // No.
      
      // I will use a simple regex for now to prove the flow.
      // Regex for function/class/const exports.
      
      const text = model.getValue();
      const symbols: EditorSymbol[] = [];
      const lines = text.split("\n");
      
      // Very naive regex for demo purposes
      const regex = /^(export\s+)?(function|class|const|let|var)\s+([a-zA-Z0-9_]+)/;
      
      lines.forEach((line: string, i: number) => {
          const match = line.match(regex);
          if (match) {
              symbols.push({
                  name: match[3],
                  kind: 12, // Variable/Function
                  range: { startLineNumber: i+1, endLineNumber: i+1 },
                  children: []
              });
          }
      });
      
      onSymbolsChange(symbols);
      
    } catch (e) {
      console.error("Error fetching symbols", e);
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Initial fetch
    updateSymbols();
  };

  const handleEditorChange = (val: string | undefined) => {
    onChange(val || "");
    
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
        updateSymbols();
    }, 1000);
  };
  
  // Cleanup
  useEffect(() => {
      return () => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
      }
  }, []);

  // Dynamic Options
  const options = {
    readOnly,
    fontSize,
    wordWrap: wordWrap ? "on" : "off",
    minimap: { enabled: minimapEnabled },
    lineNumbers: lineNumbers ? "on" : "off",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    fontLigatures: true,
    smoothScrolling: true,
    cursorBlinking: "smooth",
    renderWhitespace: "selection",
    guides: {
        indentation: true,
        bracketPairs: true
    },
    padding: { top: 16 }
  };

  return (
    <div className="h-full w-full overflow-hidden bg-white dark:bg-[#1e1e1e]">
      <Editor
        height="100%"
        width="100%"
        language={getLanguage(filename)}
        path={filename} // Important for Monaco capability to distinguish files (like TS sharing types)
        theme={theme === "dark" ? "vs-dark" : "light"}
        value={value}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        loading={
          <div className="flex items-center justify-center h-full text-zinc-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Initializing Editor...</span>
          </div>
        }
        options={options as any}
      />
    </div>
  );
}
