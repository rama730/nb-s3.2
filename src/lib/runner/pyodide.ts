import type { ExecutorResult } from "./types";

const PYODIDE_INDEX = "https://cdn.jsdelivr.net/pyodide/v0.26.3/full";
const PYODIDE_SCRIPT = `${PYODIDE_INDEX}/pyodide.js`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodideInstance: any = null;

async function ensurePyodide(): Promise<typeof pyodideInstance> {
  if (pyodideInstance) return pyodideInstance;
  if (typeof window === "undefined") throw new Error("Pyodide runs only in the browser");

  const win = window as Window & { loadPyodide?: (opts: { indexURL: string }) => Promise<unknown> };
  if (!win.loadPyodide) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = PYODIDE_SCRIPT;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Pyodide"));
      document.head.appendChild(script);
    });
  }
  pyodideInstance = await win.loadPyodide!({ indexURL: PYODIDE_INDEX });
  return pyodideInstance;
}

/** Pre-load Pyodide in the browser. Call on user action; avoids first-run delay. */
export async function preloadPyodide(): Promise<void> {
  await ensurePyodide();
}

export interface RunPythonOpts {
  /** Pre-filled stdin values; one per input() call. When provided, used instead of browser prompt. */
  stdinLines?: string[];
}

export async function runPython(code: string, opts?: RunPythonOpts): Promise<ExecutorResult> {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  const pyodide = await ensurePyodide();
  pyodide.setStdout({ batched: (s: string) => stdoutParts.push(s) });
  pyodide.setStderr({ batched: (s: string) => stderrParts.push(s) });

  const lines = opts?.stdinLines ?? [];
  let index = 0;
  pyodide.setStdin({
    stdin: () => {
      if (index < lines.length) {
        return lines[index++] ?? "";
      }
      return "";
    },
  });

  try {
    await pyodide.runPythonAsync(code);
    return {
      stdout: stdoutParts.join(""),
      stderr: stderrParts.join(""),
      exitCode: 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/I\/O error|Errno 29/i.test(msg)) {
      stderrParts.push("Hint: Provide values in the Input section above and run again.");
    }
    stderrParts.push(msg);
    return {
      stdout: stdoutParts.join(""),
      stderr: stderrParts.join(""),
      exitCode: 1,
    };
  }
}
