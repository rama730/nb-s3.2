import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = [
  "src/components/projects/v2/workspace",
  "src/components/projects/v2/explorer",
];

const ALLOWED_EXACT = new Set([
  "@/stores/filesWorkspaceStore",
]);

const ALLOWED_PREFIX = [
  "@/stores/files/types", // shared type-only enums/interfaces
];

function collectTsFiles(dir: string, acc: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, acc);
      continue;
    }
    if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      acc.push(full);
    }
  }
}

function isAllowedSpecifier(specifier: string) {
  if (ALLOWED_EXACT.has(specifier)) return true;
  return ALLOWED_PREFIX.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`));
}

const files: string[] = [];
for (const rel of TARGET_DIRS) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) collectTsFiles(abs, files);
}

const violations: Array<{ file: string; specifier: string; line: number }> = [];
const importRegex = /from\s+["']([^"']+)["']/g;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    importRegex.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = importRegex.exec(line)) !== null) {
      const specifier = match[1];
      if (!specifier.startsWith("@/stores/files")) continue;
      if (isAllowedSpecifier(specifier)) continue;
      violations.push({
        file: path.relative(ROOT, file),
        specifier,
        line: index + 1,
      });
    }
  });
}

if (violations.length > 0) {
  console.error("Found disallowed store imports in workspace/explorer modules:");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} -> ${violation.specifier}`);
  }
  process.exit(1);
}

console.log("Store import boundary check passed.");
