"use server";

import { createClient } from "@/lib/supabase/server";
import { getProjectAccessById } from "@/lib/data/project-access";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { runViaBackend } from "@/lib/runner/backend";
import type { EngineKey } from "@/lib/runner/types";

export async function getExecutionBackendStatus(): Promise<{ configured: boolean }> {
  return { configured: !!process.env.EXECUTION_BACKEND_URL };
}

/** Test connection to the execution backend. Read-only; no storage. */
export async function testExecutionBackend(): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.EXECUTION_BACKEND_URL;
  if (!url) {
    return { ok: false, error: "EXECUTION_BACKEND_URL not set" };
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${url.replace(/\/$/, "")}/api/v2/runtimes`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

const MAX_OUTPUT_LINES = 500;
const RUN_LIMIT = 60;
const RUN_WINDOW_SECONDS = 3600;

function capLogs(logs: string[]): string[] {
  if (logs.length <= MAX_OUTPUT_LINES) return logs;
  return [...logs.slice(0, MAX_OUTPUT_LINES), "(Output truncated to 500 lines)"];
}

export async function executeCodeViaBackend(
  projectId: string,
  engine: EngineKey,
  content: string,
  stdin?: string
): Promise<{ success: boolean; logs: string[]; error?: string; stderr?: string; settingsHref?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      logs: ["[error] Not authenticated"],
      error: "Not authenticated",
    };
  }

  const access = await getProjectAccessById(projectId, user.id);
  if (!access.project || !access.canRead) {
    return {
      success: false,
      logs: ["[error] Project not found or access denied"],
      error: "Project not found or access denied",
    };
  }

  if (!process.env.EXECUTION_BACKEND_URL) {
    return {
      success: false,
      logs: ["[error] Execution backend not configured. Set EXECUTION_BACKEND_URL."],
      error: "Execution backend not configured",
      settingsHref: "/settings/languages#backend",
    };
  }

  const { allowed } = await consumeRateLimit(`run:${user.id}`, RUN_LIMIT, RUN_WINDOW_SECONDS);
  if (!allowed) {
    return {
      success: false,
      logs: ["[error] Rate limit exceeded. Try again later."],
      error: "Rate limit exceeded. Try again later.",
    };
  }

  const cmd = engine === "java" ? "java Main.java" : engine === "c" ? "gcc main.c" : "g++ main.cpp";
  const header = `$ ${cmd}`;

  try {
    const result = await runViaBackend(engine, content, { stdin });
    const stdoutLines = (result.stdout || "").split("\n");
    const stderrLines = (result.stderr || "").split("\n");
    const logs = capLogs([header, ...stdoutLines, ...stderrLines]);
    return {
      success: result.exitCode === 0,
      logs,
      stderr: result.stderr || "",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      logs: capLogs([header, `[error] ${msg}`]),
      error: msg,
      stderr: msg,
    };
  }
}
