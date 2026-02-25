import { getRunnerPref } from "./prefs";

export interface ExecutorResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type EngineKey = "python" | "javascript" | "sql" | "typescript" | "java" | "c" | "cpp";

export const EXT_TO_ENGINE: Record<string, EngineKey> = {
  ".py": "python",
  ".js": "javascript",
  ".mjs": "javascript",
  ".sql": "sql",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
};

export const ENGINE_METADATA: Record<
  EngineKey,
  { type: "client" | "server"; optIn?: string }
> = {
  python: { type: "client" },
  javascript: { type: "client" },
  sql: { type: "client" },
  typescript: { type: "client", optIn: "runner.typescript.enabled" },
  java: { type: "server" },
  c: { type: "server" },
  cpp: { type: "server" },
};

export function isClientEngine(engine: EngineKey): boolean {
  return ENGINE_METADATA[engine]?.type === "client";
}

export function isEngineEnabled(engine: EngineKey): boolean {
  const meta = ENGINE_METADATA[engine];
  if (!meta?.optIn) return true;
  return getRunnerPref(meta.optIn) === "true";
}

export const supportedExtensions = Object.keys(EXT_TO_ENGINE);
