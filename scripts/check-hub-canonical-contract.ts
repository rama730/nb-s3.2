import fs from "node:fs";
import path from "node:path";

type ValidationResult = {
  errors: string[];
};

const LEGACY_HUB_CLIENT = path.join("src", "components", "hub", "HubClient.tsx");
const IMPORT_PATTERNS = [
  /from\s+["']@\/components\/hub\/HubClient["']/,
  /from\s+["']\.\/HubClient["']/,
  /from\s+["']\.\.\/hub\/HubClient["']/,
];

function collectTsFiles(dir: string, into: string[]) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, into);
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      into.push(full);
    }
  }
}

export function validateHubCanonicalContract(rootDir: string = process.cwd()): ValidationResult {
  const errors: string[] = [];
  const legacyPath = path.join(rootDir, LEGACY_HUB_CLIENT);
  if (fs.existsSync(legacyPath)) {
    errors.push(`${LEGACY_HUB_CLIENT}: legacy HubClient implementation must not exist.`);
  }

  const srcDir = path.join(rootDir, "src");
  const files: string[] = [];
  collectTsFiles(srcDir, files);

  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const source = fs.readFileSync(file, "utf8");
    if (IMPORT_PATTERNS.some((re) => re.test(source))) {
      errors.push(`${rel}: importing legacy HubClient is forbidden.`);
    }
  }

  return { errors };
}

function main() {
  const result = validateHubCanonicalContract(process.cwd());
  if (result.errors.length > 0) {
    console.error("[hub-canonical-contract] violations detected:");
    for (const err of result.errors) console.error(` - ${err}`);
    process.exit(1);
  }
  console.log("[hub-canonical-contract] ok");
}

if (require.main === module) {
  main();
}
