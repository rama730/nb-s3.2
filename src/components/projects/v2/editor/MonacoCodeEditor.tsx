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

  // Cleanup
  useEffect(() => {
      return () => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
      }
  }, []);

  // Configure Compiler Options on Mount
  const configureMonaco = async (monaco: any) => {
      // TypeScript Config
      const compilerOptions = {
          target: monaco.languages.typescript.ScriptTarget.ES2020,
          allowNonTsExtensions: true,
          moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          module: monaco.languages.typescript.ModuleKind.CommonJS,
          noEmit: true,
          esModuleInterop: true,
          jsx: monaco.languages.typescript.JsxEmit.React,
          reactNamespace: "React",
          allowJs: true,
          typeRoots: ["node_modules/@types"]
      };

      monaco.languages.typescript?.typescriptDefaults.setCompilerOptions(compilerOptions);
      monaco.languages.typescript?.javascriptDefaults.setCompilerOptions(compilerOptions);
      
      // Eager sync
      monaco.languages.typescript?.typescriptDefaults.setEagerModelSync(true);
      monaco.languages.typescript?.javascriptDefaults.setEagerModelSync(true);
  };

  const updateSymbols = async () => {
    if (!editorRef.current || !monacoRef.current || !onSymbolsChange) return;
    const model = editorRef.current.getModel();
    if (!model) return;

    try {
       // Use Worker to extract symbols (AST based)
       const resource = model.uri;
       // Only for TS/JS files
       const lang = model.getLanguageId();
       if ((lang === "typescript" || lang === "javascript") && monacoRef.current.languages.typescript) {
            const getWorker = await monacoRef.current.languages.typescript.getTypeScriptWorker();
            const worker = await getWorker(resource);
            const items = await worker.getNavigationTree(resource.toString());
            
            if (items) {
                 const transform = (item: any): EditorSymbol => ({
                     name: item.text,
                     kind: mapScriptElementKind(item.kind),
                     range: { 
                         startLineNumber: item.spans[0].start.line,
                         endLineNumber: item.spans[0].end.line 
                     },
                     children: item.childItems?.map(transform) || []
                 });

                 // Root might need check
                 const symbols = items.childItems ? items.childItems.map(transform) : [transform(items)];
                 onSymbolsChange(symbols);
                 return;
            }
       } 
       
       // Fallback for other languages or failure: naive regex (kept for non-TS)
       if (lang !== "typescript" && lang !== "javascript") {
           const text = model.getValue();
           const symbols: EditorSymbol[] = [];
           const lines = text.split("\n");
           const regex = /^(export\s+)?(function|class|const|let|var)\s+([a-zA-Z0-9_]+)/;
           lines.forEach((line: string, i: number) => {
               const match = line.match(regex);
               if (match) {
                   symbols.push({
                       name: match[3],
                       kind: 12,
                       range: { startLineNumber: i+1, endLineNumber: i+1 },
                       children: []
                   });
               }
           });
           onSymbolsChange(symbols);
       }

    } catch (e) {
      console.error("Error fetching symbols", e);
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // Config
    configureMonaco(monaco);

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
    padding: { top: 16 },
    stickyScroll: { enabled: true }
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

// Helper to map TS Kinds to Monaco/VSCode Kinds
const mapScriptElementKind = (kind: string): number => {
    switch(kind) {
        case "module": return 1; // File
        case "class": return 5; // Class
        case "enum": return 9; // Enum
        case "interface": return 10; // Interface
        case "method": return 11; // Method
        case "function": return 11; // Function
        case "var": return 12; // Variable
        case "let": return 12;
        case "const": return 13; // Constant
        case "local function": return 11;
        case "local var": return 12;
        default: return 12; // Variable default
    }
};
