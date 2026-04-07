import fs from "node:fs";
import path from "node:path";

type ValidationResult = {
  errors: string[];
  checkedFiles: number;
};

const API_V1_DIR = path.join("src", "app", "api", "v1");
const ROUTE_FILE = "route.ts";
const SHARED_IMPORT_RE = /from\s+["'][^"']*\/api\/v1\/(_shared|_envelope)["']/;
const DIRECT_NEXT_RESPONSE_RE = /NextResponse\.json\s*\(/;
const HELPER_CALL_RE = /\b(jsonSuccess|jsonError)\s*\(/;

// Routes that use third-party SDK response handlers (e.g. Inngest serve())
const ENVELOPE_EXEMPT_ROUTES = new Set<string>([
  path.join("src", "app", "api", "v1", "inngest", "route.ts"),
]);

function collectRouteFiles(dir: string, into: string[]) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRouteFiles(full, into);
      continue;
    }
    if (entry.isFile() && entry.name === ROUTE_FILE) {
      into.push(full);
    }
  }
}

export function validateApiEnvelopeContract(rootDir: string = process.cwd()): ValidationResult {
  const errors: string[] = [];
  const routeFiles: string[] = [];
  collectRouteFiles(path.join(rootDir, API_V1_DIR), routeFiles);

  for (const file of routeFiles) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(rootDir, file);

    if (ENVELOPE_EXEMPT_ROUTES.has(rel)) continue;

    if (DIRECT_NEXT_RESPONSE_RE.test(source)) {
      errors.push(
        `${rel}: direct NextResponse.json(...) usage is forbidden in /api/v1 routes; use jsonSuccess/jsonError.`,
      );
    }

    const usesHelpers = HELPER_CALL_RE.test(source);
    if (!usesHelpers) {
      errors.push(`${rel}: route must use jsonSuccess/jsonError helpers.`);
      continue;
    }

    if (!SHARED_IMPORT_RE.test(source)) {
      errors.push(
        `${rel}: jsonSuccess/jsonError must be imported from /api/v1/_shared or /api/v1/_envelope.`,
      );
    }
  }

  return {
    errors,
    checkedFiles: routeFiles.length,
  };
}

function main() {
  const result = validateApiEnvelopeContract(process.cwd());
  if (result.errors.length > 0) {
    console.error("[api-envelope-contract] violations detected:");
    for (const err of result.errors) console.error(` - ${err}`);
    process.exit(1);
  }
  console.log(`[api-envelope-contract] ok (${result.checkedFiles} route files)`);
}

if (require.main === module) {
  main();
}
