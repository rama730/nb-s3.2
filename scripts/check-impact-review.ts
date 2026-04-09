import fs from "node:fs";
import path from "node:path";

import { parseImpactReviewRecord, type ImpactReviewRecord } from "../src/lib/standards/impact-review";

type ValidationOptions = {
  strict?: boolean;
  changedPaths?: string[];
};

type ValidationResult = {
  errors: string[];
  warnings: string[];
  checkedRecords: number;
};

const IMPACT_REVIEW_DIR = path.join("standards", "impact-reviews");
const HIGH_RISK_PREFIXES = [
  "src/app/api/",
  "src/app/actions/",
  "src/lib/realtime/",
  "src/inngest/",
  "drizzle/",
  "src/lib/security/",
  "src/lib/performance/",
  "src/lib/routing/",
  "src/lib/standards/",
] as const;

function toPosix(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function listImpactReviewFiles(rootDir: string) {
  const dir = path.join(rootDir, IMPACT_REVIEW_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dir, entry));
}

function parseChangedPaths(options?: ValidationOptions) {
  const provided = options?.changedPaths;
  if (provided && provided.length > 0) {
    return provided.map((value) => value.trim()).filter(Boolean);
  }

  const raw = process.env.IMPACT_REVIEW_CHANGED_PATHS;
  if (!raw) return [];
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function isHighRiskPath(filePath: string) {
  return HIGH_RISK_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function recordCoversPath(record: ImpactReviewRecord, changedPath: string) {
  return record.paths.some((coveredPath) => {
    if (changedPath === coveredPath) return true;
    return changedPath.startsWith(`${coveredPath.replace(/\/+$/, "")}/`);
  });
}

export function validateImpactReview(
  rootDir: string = process.cwd(),
  options: ValidationOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const records: ImpactReviewRecord[] = [];

  for (const file of listImpactReviewFiles(rootDir)) {
    const rel = toPosix(path.relative(rootDir, file));
    try {
      records.push(parseImpactReviewRecord(JSON.parse(fs.readFileSync(file, "utf8"))));
    } catch (error) {
      errors.push(`${rel}: failed to parse impact review record (${error instanceof Error ? error.message : "unknown error"}).`);
    }
  }

  const changedPaths = parseChangedPaths(options);
  const highRiskChangedPaths = changedPaths.filter(isHighRiskPath);

  for (const changedPath of highRiskChangedPaths) {
    const covered = records.some((record) => recordCoversPath(record, changedPath));
    if (covered) continue;

    const message =
      `${changedPath}: high-risk path is missing a covering machine-readable impact review in ${IMPACT_REVIEW_DIR}.`;
    if (options.strict) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  return {
    errors,
    warnings,
    checkedRecords: records.length,
  };
}

function main() {
  const strict = process.argv.includes("--strict");
  const pathsArg = process.argv.find((arg) => arg.startsWith("--paths="));
  const changedPaths = pathsArg ? pathsArg.replace("--paths=", "").split(",") : undefined;
  const result = validateImpactReview(process.cwd(), { strict, changedPaths });

  if (result.warnings.length > 0) {
    console.warn("[impact-review] warnings:");
    for (const warning of result.warnings) {
      console.warn(` - ${warning}`);
    }
  }

  if (result.errors.length > 0) {
    console.error("[impact-review] violations detected:");
    for (const error of result.errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log(`[impact-review] ok (${result.checkedRecords} records checked)`);
}

if (require.main === module) {
  main();
}
