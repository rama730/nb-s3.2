import type { ExecutorResult } from "./types";

const PISTON_ENGINE_TO_LANGUAGE: Record<string, string> = {
  java: "java",
  c: "c",
  cpp: "c++",
};

export async function runViaBackend(
  engine: string,
  code: string,
  opts?: { stdin?: string; version?: string }
): Promise<ExecutorResult> {
  const url = process.env.EXECUTION_BACKEND_URL;
  if (!url) {
    throw new Error("Execution backend not configured (EXECUTION_BACKEND_URL)");
  }

  const language = PISTON_ENGINE_TO_LANGUAGE[engine] ?? engine;
  const fileName = engine === "java" ? "Main.java" : engine === "c" ? "main.c" : "main.cpp";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/v2/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language,
        version: opts?.version ?? "*",
        files: [{ name: fileName, content: code }],
        stdin: opts?.stdin ?? "",
        run_timeout: 30_000,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Backend error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      run?: { stdout?: string; stderr?: string; code?: number };
      compile?: { stderr?: string; code?: number };
    };

    const run = data.run;
    const compile = data.compile;

    const stdout = run?.stdout ?? "";
    let stderr = run?.stderr ?? "";
    const runCode = run?.code ?? 1;

    if (compile && compile.code !== 0) {
      stderr = (compile.stderr ?? "") + (stderr ? "\n" + stderr : "");
    }

    return {
      stdout,
      stderr,
      exitCode: runCode,
    };
  } finally {
    clearTimeout(timeout);
  }
}
