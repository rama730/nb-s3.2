"use server";

import { createClient } from "@/lib/supabase/server";
import { assertProjectAccess } from "./files/_shared";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import type { Problem } from "@/stores/files/types";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const JS_EXTS = new Set([".js", ".mjs", ".ts", ".tsx", ".jsx"]);

/**
 * Lint file content and return Problem[].
 * - ESLint for .js, .mjs, .ts, .tsx, .jsx
 * - Pyright for .py
 * Rate limit: 120 runs per user per hour.
 */
export async function lintFileAction(
  projectId: string,
  nodeId: string,
  content: string,
  filePath: string
): Promise<{ ok: true; problems: Problem[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  try {
    await assertProjectAccess(projectId, user.id);
  } catch {
    return { ok: false, error: "Forbidden" };
  }

  const { allowed } = await consumeRateLimit(`lint:${user.id}`, 120, 3600);
  if (!allowed) return { ok: false, error: "Lint rate limit exceeded (120/hour)" };

  const ext = filePath.includes(".") ? "." + filePath.split(".").pop()!.toLowerCase() : "";

  if (JS_EXTS.has(ext)) {
    return lintWithESLint(projectId, nodeId, content, filePath);
  }
  if (ext === ".py") {
    return lintWithPyright(projectId, nodeId, content, filePath);
  }

  return { ok: true, problems: [] };
}

async function lintWithESLint(
  projectId: string,
  nodeId: string,
  content: string,
  filePath: string
): Promise<{ ok: true; problems: Problem[] } | { ok: false; error: string }> {
  try {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: {
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          parserOptions: {
            ecmaFeatures: { jsx: true },
          },
        },
        rules: {},
      },
    });

    const results = await eslint.lintText(content, {
      filePath: filePath.startsWith("/") ? filePath : `/${filePath}`,
      warnIgnored: false,
    });

    const problems: Problem[] = [];
    let idSeed = 0;
    for (const r of results) {
      for (const m of r.messages) {
        if (m.line == null) continue;
        problems.push({
          id: `lint-${projectId}-${nodeId}-${idSeed++}`,
          nodeId,
          filePath,
          line: m.line,
          column: m.column ?? undefined,
          severity: m.severity === 2 ? "warning" : m.severity === 1 ? "info" : "error",
          message: m.message ?? "Lint issue",
          source: "linter",
        });
      }
    }
    return { ok: true, problems };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "ESLint failed",
    };
  }
}

async function lintWithPyright(
  projectId: string,
  nodeId: string,
  content: string,
  filePath: string
): Promise<{ ok: true; problems: Problem[] } | { ok: false; error: string }> {
  let tmpDir: string | null = null;
  let tmpFile: string | null = null;

  try {
    const { spawn } = await import("child_process");
    const { promisify } = await import("util");
    tmpDir = await mkdtemp(join(tmpdir(), "pyright-"));
    const baseName = filePath.split("/").pop() ?? "file.py";
    tmpFile = join(tmpDir, baseName);
    await writeFile(tmpFile, content, "utf-8");

    const proc = spawn("npx", ["pyright", "--outputjson", tmpFile], {
      cwd: tmpDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    const chunks: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    const stderrChunks: Buffer[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    await new Promise<void>((resolve, reject) => {
      proc.on("close", (code) => {
        if (code === 0 || code === 1) resolve();
        else reject(new Error(`Pyright exited ${code}`));
      });
    });

    const raw = Buffer.concat(chunks).toString("utf-8");
    let json: { generalDiagnostics?: Array<{ range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }; message: string; severity?: string }> };
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: true, problems: [] };
    }

    const diags = json.generalDiagnostics ?? [];
    const problems: Problem[] = [];
    let idSeed = 0;
    for (const d of diags) {
      const line = d.range?.start?.line != null ? d.range.start.line + 1 : undefined;
      const column = d.range?.start?.character != null ? d.range.start.character + 1 : undefined;
      if (line == null) continue;
      const severity =
        d.severity === "warning"
          ? "warning"
          : d.severity === "information"
            ? "info"
            : "error";
      problems.push({
        id: `lint-${projectId}-${nodeId}-${idSeed++}`,
        nodeId,
        filePath,
        line,
        column,
        severity: severity as "error" | "warning" | "info",
        message: d.message ?? "Type error",
        source: "linter",
      });
    }
    return { ok: true, problems };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Pyright failed",
    };
  } finally {
    if (tmpFile) {
      try {
        await unlink(tmpFile);
      } catch {
        /* ignore */
      }
    }
    if (tmpDir) {
      try {
        const { rm } = await import("fs/promises");
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Get display path for a node (for Problem filePath).
 */
export async function getNodeDisplayPath(
  projectId: string,
  nodeId: string
): Promise<string | null> {
  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.projectId, projectId),
      eq(projectNodes.id, nodeId),
      isNull(projectNodes.deletedAt)
    ),
    columns: { id: true, name: true, parentId: true },
  });
  if (!node) return null;

  const pathParts: string[] = [node.name];
  let parentId = node.parentId;

  while (parentId) {
    const parent = await db.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.projectId, projectId),
        eq(projectNodes.id, parentId),
        isNull(projectNodes.deletedAt)
      ),
      columns: { name: true, parentId: true },
    });
    if (!parent) break;
    pathParts.unshift(parent.name);
    parentId = parent.parentId;
  }

  return pathParts.join("/");
}
