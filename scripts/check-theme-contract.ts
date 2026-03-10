import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CheckResult = {
  errors: string[];
};

const ALLOWED_NEXT_THEMES_IMPORT = "src/components/providers/theme-provider.tsx";
const LEGACY_THEME_PROVIDER_PATH = "src/components/theme/ThemeProvider.tsx";
const SOURCE_DIR = "src";

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function listSourceFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        out.push(fullPath);
      }
    }
  };
  walk(rootDir);
  return out;
}

function checkImports(repoRoot: string): string[] {
  const errors: string[] = [];
  const srcRoot = path.join(repoRoot, SOURCE_DIR);
  if (!fs.existsSync(srcRoot)) return errors;

  const files = listSourceFiles(srcRoot);
  for (const filePath of files) {
    const rel = toPosix(path.relative(repoRoot, filePath));
    const content = fs.readFileSync(filePath, "utf8");
    const importsNextThemes = /from\s+['"]next-themes['"]/.test(content);
    if (importsNextThemes && rel !== ALLOWED_NEXT_THEMES_IMPORT) {
      errors.push(`${rel} imports next-themes directly (allowed only in ${ALLOWED_NEXT_THEMES_IMPORT}).`);
    }

    if (/from\s+['"]@\/components\/theme\/ThemeProvider['"]/.test(content)) {
      errors.push(`${rel} imports removed legacy provider path "@/components/theme/ThemeProvider".`);
    }
  }

  return errors;
}

function checkLegacyProviderFile(repoRoot: string): string[] {
  const legacyPath = path.join(repoRoot, LEGACY_THEME_PROVIDER_PATH);
  if (fs.existsSync(legacyPath)) {
    return [`Legacy provider file must not exist: ${LEGACY_THEME_PROVIDER_PATH}`];
  }
  return [];
}

export function validateThemeContract(repoRoot: string = process.cwd()): CheckResult {
  const errors = [
    ...checkImports(repoRoot),
    ...checkLegacyProviderFile(repoRoot),
  ];
  return { errors };
}

function main() {
  const { errors } = validateThemeContract(process.cwd());
  if (errors.length > 0) {
    console.error("[theme-contract] violations detected:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  console.log("[theme-contract] ok");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
