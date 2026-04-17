import { findNodeByPathAny } from "@/app/actions/files/nodes";
import { getProjectFileContent } from "@/app/actions/files/content";
import { parseCommand, getEngineByExt } from "./router";
import { runPython } from "./pyodide";
import { runJavaScript } from "./javascript";
import { runSql } from "./sql";
import { runTypeScript } from "./typescript";
import { isClientEngine, isEngineEnabled } from "./types";

const SUPPORTED_INTERPRETERS = ["python", "python3", "node", "nodejs", "sql", "ts-node", "tsx", "java", "gcc", "g++"];
const MAX_OUTPUT_LINES = 500;

function capLogs(logs: string[]): string[] {
  if (logs.length <= MAX_OUTPUT_LINES) return logs;
  return [...logs.slice(0, MAX_OUTPUT_LINES), "(Output truncated to 500 lines)"];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Execution timed out after ${ms / 1000}s`)), ms)
  );
  return Promise.race([p, timeout]);
}

function isSupportedCommand(cmd: string): boolean {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  const interpreter = (parts[0] ?? "").toLowerCase();
  return SUPPORTED_INTERPRETERS.includes(interpreter);
}

const NEEDS_INPUT_MSG = "Enter values in the Input section above and run again.";

const JAVA_EXT_HINT =
  "This file contains Java code. Rename to .java to run it. (Use a .java extension.)";

function looksLikeJava(content: string): boolean {
  const head = content.trim().slice(0, 800);
  return /import\s+java\.|public\s+class\s+\w+|Scanner\s*\(|String\[\s*\]\s+args/.test(head);
}

export async function runFileInBrowser(
  projectId: string,
  command: string,
  activeFilePath?: string,
  opts?: { stdinLines?: string[] }
): Promise<{ success: boolean; logs: string[]; error?: string; stderr?: string; settingsHref?: string }> {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      success: false,
      logs: [`$ ${trimmed}`, "[error] No command provided"],
      error: "No command provided",
    };
  }

  const parsed = parseCommand(trimmed);
  if (!parsed) {
    return {
      success: false,
      logs: [`$ ${trimmed}`, "[error] Use format: python file.py, node file.js, java Main.java, etc."],
      error: "Use format: python file.py, node file.js, java Main.java, etc.",
    };
  }

  const { path: filePath, ext } = parsed;
  const engine = getEngineByExt(ext);
  if (!engine) {
    return {
      success: false,
      logs: [`$ ${trimmed}`, `[error] Unsupported file type: ${ext}`],
      error: `Unsupported file type: ${ext}. Supported: .py, .js, .mjs, .sql, .ts, .tsx, .java, .c, .cpp`,
    };
  }

  if (engine === "typescript" && !isEngineEnabled(engine)) {
    return {
      success: false,
      logs: [`$ ${trimmed}`, "[error] Enable TypeScript in Settings > Languages to run .ts/.tsx files."],
      error: "Enable TypeScript in Settings > Languages to run .ts/.tsx files.",
      settingsHref: "/settings/languages#typescript",
    };
  }

  let pathParts = filePath.split("/").filter(Boolean);
  let node;
  try {
    node = await findNodeByPathAny(projectId, pathParts);
    if (!node && activeFilePath) {
      const activeBasename = activeFilePath.split("/").pop() ?? "";
      if (activeBasename === filePath) {
        pathParts = activeFilePath.split("/").filter(Boolean);
        node = await findNodeByPathAny(projectId, pathParts);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      logs: [`$ ${trimmed}`, `[error] ${msg}`],
      error: msg,
    };
  }

  if (!node) {
    return {
      success: false,
      logs: [`$ ${trimmed}`, `[error] File not found: ${filePath}`],
      error: `File not found: ${filePath}`,
    };
  }

  if (node.type !== "file") {
    return {
      success: false,
      logs: [`$ ${trimmed}`, "[error] Target must be a file"],
      error: "Target must be a file",
    };
  }

  let content: string;
  try {
    content = await getProjectFileContent(projectId, node.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      logs: [`$ ${trimmed}`, `[error] ${msg}`],
      error: msg,
    };
  }

  if (engine === "python" && !opts?.stdinLines?.length && /input\s*\(/.test(content)) {
    return {
      success: false,
      logs: capLogs([`$ ${trimmed}`, NEEDS_INPUT_MSG]),
      error: NEEDS_INPUT_MSG,
    };
  }

  if (engine === "javascript" && looksLikeJava(content)) {
    return {
      success: false,
      logs: capLogs([`$ ${trimmed}`, `[error] ${JAVA_EXT_HINT}`]),
      error: JAVA_EXT_HINT,
      settingsHref: "/settings/languages",
    };
  }

  if (!isClientEngine(engine)) {
    const { executeCodeViaBackend } = await import("@/app/actions/execute");
    return executeCodeViaBackend(projectId, engine, content, opts?.stdinLines?.join("\n"));
  }

  try {
    let result;
    switch (engine) {
      case "python":
        result = await withTimeout(runPython(content, { stdinLines: opts?.stdinLines }), 30_000);
        break;
      case "javascript":
        result = await withTimeout(runJavaScript(content), 30_000);
        break;
      case "sql":
        result = await withTimeout(runSql(content), 30_000);
        break;
      case "typescript":
        result = await withTimeout(runTypeScript(content, ext === ".tsx" ? ".tsx" : ".ts"), 30_000);
        break;
      default:
        return {
          success: false,
          logs: [`$ ${trimmed}`, `[error] Unknown engine: ${engine}`],
          error: `Unknown engine: ${engine}`,
        };
    }

    const stdoutLines = (result.stdout || "").split("\n");
    const stderrLines = (result.stderr || "").split("\n");

    const logs = capLogs([`$ ${trimmed}`, ...stdoutLines, ...stderrLines]);
    return {
      success: result.exitCode === 0,
      logs,
      stderr: result.stderr || "",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      logs: [`$ ${trimmed}`, `[error] ${msg}`],
      error: msg,
      stderr: msg,
    };
  }
}

const EXT_TO_CMD: Record<string, string> = {
  ".py": "python",
  ".js": "node",
  ".mjs": "node",
  ".sql": "sql",
  ".ts": "ts-node",
  ".tsx": "ts-node",
  ".java": "java",
  ".c": "gcc",
  ".cpp": "g++",
  ".cc": "g++",
};

export interface RunFileWithContentOpts {
  /** Pre-filled stdin for Python input(); one value per input() call. */
  stdinLines?: string[];
}

/**
 * Run file content in-browser with zero server calls (client engines).
 * Server engines (Java, C, C++) call executeCodeViaBackend.
 */
export async function runFileWithContent(
  projectId: string,
  filePath: string,
  content: string,
  opts?: RunFileWithContentOpts
): Promise<{ success: boolean; logs: string[]; error?: string; stderr?: string; settingsHref?: string }> {
  const lastDot = filePath.lastIndexOf(".");
  const ext = lastDot >= 0 ? filePath.slice(lastDot).toLowerCase() : "";
  const engine = getEngineByExt(ext);

  if (!engine) {
    const logs = [`$ ${EXT_TO_CMD[".py"] ?? "python"} ${filePath}`, `[error] Unsupported file type: ${ext}. Supported: .py, .js, .mjs, .sql, .ts, .tsx, .java, .c, .cpp`];
    return { success: false, logs, error: `Unsupported file type: ${ext}` };
  }

  if (engine === "typescript" && !isEngineEnabled(engine)) {
    return {
      success: false,
      logs: [`$ ${EXT_TO_CMD[ext] ?? "ts-node"} ${filePath}`, "[error] Enable TypeScript in Settings > Languages to run .ts/.tsx files."],
      error: "Enable TypeScript in Settings > Languages to run .ts/.tsx files.",
      settingsHref: "/settings/languages#typescript",
    };
  }

  if (!isClientEngine(engine)) {
    const { executeCodeViaBackend } = await import("@/app/actions/execute");
    return executeCodeViaBackend(projectId, engine, content, opts?.stdinLines?.join("\n"));
  }

  const interpreter = EXT_TO_CMD[ext] ?? "python";
  const cmd = `${interpreter} ${filePath}`;

  if (engine === "python" && !opts?.stdinLines?.length && /input\s*\(/.test(content)) {
    return {
      success: false,
      logs: capLogs([`$ ${cmd}`, NEEDS_INPUT_MSG]),
      error: NEEDS_INPUT_MSG,
    };
  }

  if (engine === "javascript" && looksLikeJava(content)) {
    return {
      success: false,
      logs: capLogs([`$ ${cmd}`, `[error] ${JAVA_EXT_HINT}`]),
      error: JAVA_EXT_HINT,
      settingsHref: "/settings/languages",
    };
  }

  try {
    let result;
    switch (engine) {
      case "python":
        result = await withTimeout(
          runPython(content, { stdinLines: opts?.stdinLines }),
          30_000
        );
        break;
      case "javascript":
        result = await withTimeout(runJavaScript(content), 30_000);
        break;
      case "sql":
        result = await withTimeout(runSql(content), 30_000);
        break;
      case "typescript":
        result = await withTimeout(runTypeScript(content, ext === ".tsx" ? ".tsx" : ".ts"), 30_000);
        break;
      default:
        return {
          success: false,
          logs: [`$ ${cmd}`, `[error] Unknown engine: ${engine}`],
          error: `Unknown engine: ${engine}`,
        };
    }

    const stdoutLines = (result.stdout || "").split("\n");
    const stderrLines = (result.stderr || "").split("\n");
    const logs = capLogs([`$ ${cmd}`, ...stdoutLines, ...stderrLines]);
    return {
      success: result.exitCode === 0,
      logs,
      stderr: result.stderr || "",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      logs: [`$ ${cmd}`, `[error] ${msg}`],
      error: msg,
      stderr: msg,
    };
  }
}

export { isSupportedCommand };
