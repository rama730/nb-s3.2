"use server";

import { findNodeByPathAny } from "./files/nodes";
import type { Problem } from "@/stores/files/types";

/**
 * Parse stderr from Python/JS execution into Problem[].
 * Resolves file paths to nodeIds via findNodeByPathAny.
 */
export async function parseStderrToProblems(
  projectId: string,
  stderr: string
): Promise<Problem[]> {
  if (!stderr?.trim()) return [];

  const problems: Problem[] = [];
  let idSeed = 0;

  // Python: File "path", line N or File "path", line N, in ...
  const pyRegex = /File\s+"([^"]+)"(?:,\s*line\s+(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = pyRegex.exec(stderr)) !== null) {
    const filePath = m[1]?.trim();
    if (!filePath || filePath === "<exec>" || filePath.startsWith("<")) continue;
    const line = m[2] ? parseInt(m[2], 10) : undefined;
    const pathParts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
    try {
      const node = await findNodeByPathAny(projectId, pathParts);
      if (node?.type === "file") {
        const nextLine = stderr.slice(m.index).split("\n")[0];
        problems.push({
          id: `exec-${projectId}-${idSeed++}`,
          nodeId: node.id,
          filePath: pathParts.join("/"),
          line,
          severity: "error",
          message: nextLine?.trim() || "Error",
          source: "execution",
        });
      }
    } catch {
      // Skip if resolution fails
    }
  }

  // JavaScript: at ... (path:line:col) or path:line:col
  const lines = stderr.split("\n");
  for (const line of lines) {
    const match = line.match(/at\s+(?:\S+\s+\()?([^:)]+):(\d+):(\d+)/);
    if (match) {
      const [, path, lineNum, col] = match;
      if (path && !path.startsWith("<")) {
        const pathParts = path.replace(/\\/g, "/").split("/").filter(Boolean);
        try {
          const node = await findNodeByPathAny(projectId, pathParts);
          if (node?.type === "file") {
            problems.push({
              id: `exec-${projectId}-${idSeed++}`,
              nodeId: node.id,
              filePath: pathParts.join("/"),
              line: parseInt(lineNum ?? "0", 10) || undefined,
              column: parseInt(col ?? "0", 10) || undefined,
              severity: "error",
              message: line.trim(),
              source: "execution",
            });
          }
        } catch {
          // Skip
        }
      }
    }
  }

  // Java: at package.Class.method(File.java:42) or at File.java:42
  const javaRegex = /at\s+(?:\S+\s+\()?([^:)]+\.java):(\d+)\)?/g;
  while ((m = javaRegex.exec(stderr)) !== null) {
    const filePath = m[1]?.trim();
    if (!filePath || filePath.startsWith("<")) continue;
    const line = m[2] ? parseInt(m[2], 10) : undefined;
    const pathParts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
    try {
      const node = await findNodeByPathAny(projectId, pathParts);
      if (node?.type === "file") {
        const nextLine = stderr.slice(m.index).split("\n")[0];
        problems.push({
          id: `exec-${projectId}-${idSeed++}`,
          nodeId: node.id,
          filePath: pathParts.join("/"),
          line,
          severity: "error",
          message: nextLine?.trim() || "Error",
          source: "execution",
        });
      }
    } catch {
      // Skip
    }
  }

  // C/C++: file.c:42:5: error: or file.cpp:10:1: error:
  const cRegex = /([^\s]+\.(?:c|cpp|cc)):(\d+):(\d+)?:?\s*(?:error|warning):/g;
  while ((m = cRegex.exec(stderr)) !== null) {
    const filePath = m[1]?.trim();
    if (!filePath) continue;
    const pathParts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
    try {
      const node = await findNodeByPathAny(projectId, pathParts);
      if (node?.type === "file") {
        const lineNum = m[2] ? parseInt(m[2], 10) : undefined;
        const colNum = m[3] ? parseInt(m[3], 10) : undefined;
        const nextLine = stderr.slice(m.index).split("\n")[0];
        problems.push({
          id: `exec-${projectId}-${idSeed++}`,
          nodeId: node.id,
          filePath: pathParts.join("/"),
          line: lineNum,
          column: colNum,
          severity: "error",
          message: nextLine?.trim() || "Error",
          source: "execution",
        });
      }
    } catch {
      // Skip
    }
  }

  return problems;
}
