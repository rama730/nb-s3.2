import { db } from "@/lib/db";
import { projectFileIndex, projectNodes } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { StartRunInput, StartRunResult } from "@/lib/runner/contracts";

type IndexedFile = {
    nodeId: string;
    name: string;
    parentId: string | null;
    mimeType: string | null;
    content: string;
};

const MAX_ANALYZED_FILES = 2500;
const MAX_LOG_LINES = 1200;

function pushLog(
    logs: Array<{ stream: "stdout" | "stderr" | "system"; message: string }>,
    stream: "stdout" | "stderr" | "system",
    message: string,
) {
    if (logs.length >= MAX_LOG_LINES) return;
    logs.push({ stream, message });
}

function extensionOf(name: string) {
    const index = name.lastIndexOf(".");
    if (index === -1) return "";
    return name.slice(index).toLowerCase();
}

function positionToLineColumn(content: string, position: number) {
    const normalized = Math.max(0, Math.min(position, content.length));
    const before = content.slice(0, normalized);
    const lines = before.split("\n");
    return {
        line: lines.length,
        column: (lines[lines.length - 1] || "").length + 1,
    };
}

function parseJsonErrorPosition(message: string) {
    const match = message.match(/position\s+(\d+)/i);
    if (!match) return null;
    return Number(match[1]);
}

function parseFunctionSyntaxStack(stack?: string) {
    if (!stack) return null;
    const match = stack.match(/<anonymous>:(\d+):(\d+)/);
    if (!match) return null;
    return { line: Number(match[1]), column: Number(match[2]) };
}

function getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return fallback;
}

function buildNodePath(
    nodeId: string,
    nodeById: Map<string, { id: string; name: string; parentId: string | null }>,
    cache: Map<string, string>,
): string {
    const cached = cache.get(nodeId);
    if (cached) return cached;
    const node = nodeById.get(nodeId);
    if (!node) return "";
    if (!node.parentId) {
        cache.set(nodeId, node.name);
        return node.name;
    }
    const parentPath = buildNodePath(node.parentId, nodeById, cache);
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    cache.set(nodeId, path);
    return path;
}

export async function runLocalAnalyzer(input: StartRunInput): Promise<StartRunResult> {
    const startedAt = Date.now();
    const logs: StartRunResult["logs"] = [];
    const diagnostics: StartRunResult["diagnostics"] = [];

    const [allNodes, indexedFiles] = await Promise.all([
        db
            .select({
                id: projectNodes.id,
                name: projectNodes.name,
                parentId: projectNodes.parentId,
            })
            .from(projectNodes)
            .where(and(eq(projectNodes.projectId, input.projectId), isNull(projectNodes.deletedAt)))
            .limit(MAX_ANALYZED_FILES * 2),
        db
            .select({
                nodeId: projectNodes.id,
                name: projectNodes.name,
                parentId: projectNodes.parentId,
                mimeType: projectNodes.mimeType,
                content: projectFileIndex.content,
            })
            .from(projectNodes)
            .innerJoin(projectFileIndex, eq(projectFileIndex.nodeId, projectNodes.id))
            .where(and(eq(projectNodes.projectId, input.projectId), isNull(projectNodes.deletedAt), eq(projectNodes.type, "file")))
            .limit(MAX_ANALYZED_FILES),
    ]);

    const files = indexedFiles as IndexedFile[];
    const command = (input.command || "analyze").trim();
    const commandLower = command.toLowerCase();

    pushLog(logs, "system", `$ ${command}`);
    pushLog(logs, "system", `Indexed ${files.length} files for analysis`);

    const nodeById = new Map(allNodes.map((node) => [node.id, node]));
    const pathCache = new Map<string, string>();

    let warningCount = 0;
    let errorCount = 0;

    const addDiagnostic = (payload: Omit<StartRunResult["diagnostics"][number], "severity"> & { severity: "error" | "warning" | "info" }) => {
        diagnostics.push(payload);
        if (payload.severity === "error") errorCount += 1;
        if (payload.severity === "warning") warningCount += 1;
    };

    for (const file of files) {
        const path = buildNodePath(file.nodeId, nodeById, pathCache);
        const ext = extensionOf(file.name);
        const content = file.content || "";

        if (ext === ".json") {
            try {
                JSON.parse(content);
            } catch (error: unknown) {
                const rawMessage = getErrorMessage(error, "Invalid JSON");
                const position = parseJsonErrorPosition(rawMessage);
                const lineColumn = position !== null ? positionToLineColumn(content, position) : null;
                addDiagnostic({
                    nodeId: file.nodeId,
                    filePath: path,
                    line: lineColumn?.line ?? null,
                    column: lineColumn?.column ?? null,
                    source: "json-parser",
                    code: "JSON_PARSE",
                    message: rawMessage,
                    severity: "error",
                });
                pushLog(logs, "stderr", `${path}${lineColumn ? `:${lineColumn.line}:${lineColumn.column}` : ""} ${rawMessage}`);
            }
        }

        if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(ext)) {
            try {
                const stripped = content
                    .replace(/^\s*import\s.+$/gm, "")
                    .replace(/^\s*export\s+default\s+/gm, "")
                    .replace(/^\s*export\s+/gm, "");
                // Parse-only syntax gate (does not execute user code).
                new Function(stripped);
            } catch (error: unknown) {
                const rawMessage = getErrorMessage(error, "Syntax error");
                const stack = error instanceof Error ? error.stack : undefined;
                const lineColumn = parseFunctionSyntaxStack(stack);
                addDiagnostic({
                    nodeId: file.nodeId,
                    filePath: path,
                    line: lineColumn?.line ?? null,
                    column: lineColumn?.column ?? null,
                    source: "syntax-check",
                    code: "SYNTAX",
                    message: rawMessage,
                    severity: "error",
                });
                pushLog(logs, "stderr", `${path}${lineColumn ? `:${lineColumn.line}:${lineColumn.column}` : ""} ${rawMessage}`);
            }
        }

        if (content.includes("\t")) {
            addDiagnostic({
                nodeId: file.nodeId,
                filePath: path,
                line: null,
                column: null,
                source: "style",
                code: "TAB_CHAR",
                message: "File contains tab characters. Prefer spaces for consistent formatting.",
                severity: "warning",
            });
        }
    }

    if (commandLower.includes("test")) {
        const hasTests = files.some((file) => /\.test\.|\.spec\./i.test(file.name));
        if (!hasTests) {
            addDiagnostic({
                nodeId: null,
                filePath: null,
                line: null,
                column: null,
                source: "runner",
                code: "NO_TESTS",
                message: "No test files detected for test run profile.",
                severity: "warning",
            });
            pushLog(logs, "stderr", "No test files found (*.test.* / *.spec.*).");
        } else {
            pushLog(logs, "stdout", "Test files detected.");
        }
    }

    if (commandLower.includes("build")) {
        pushLog(logs, "stdout", "Build analysis completed (static checks mode).");
    }

    if (commandLower.includes("lint")) {
        pushLog(logs, "stdout", "Lint analysis completed (static checks mode).");
    }

    const duration = Date.now() - startedAt;
    pushLog(
        logs,
        "system",
        `Finished in ${duration}ms — errors: ${errorCount}, warnings: ${warningCount}`,
    );

    return {
        status: errorCount > 0 ? "failed" : "success",
        exitCode: errorCount > 0 ? 1 : 0,
        logs,
        diagnostics,
    };
}
