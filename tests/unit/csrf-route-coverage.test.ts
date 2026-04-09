import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const API_V1_ROOT = path.resolve(process.cwd(), "src/app/api/v1");
const EXEMPT_MUTATING_ROUTES = new Set([
  path.resolve(API_V1_ROOT, "webhooks/github/route.ts"),
]);

function collectRouteFiles(root: string, files: string[] = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectRouteFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name === "route.ts") {
      files.push(fullPath);
    }
  }
  return files;
}

test("mutating API v1 routes require CSRF validation unless explicitly exempted", () => {
  const routeFiles = collectRouteFiles(API_V1_ROOT);

  for (const filePath of routeFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const hasMutatingHandler = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(source);
    if (!hasMutatingHandler || EXEMPT_MUTATING_ROUTES.has(filePath)) {
      continue;
    }

    assert.match(
      source,
      /validateCsrf\(/,
      `${path.relative(process.cwd(), filePath)} is missing validateCsrf()`,
    );
  }
});
