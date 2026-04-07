import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CheckResult = {
  errors: string[];
};

const ROOT_LAYOUT_DISALLOWED_METADATA_KEYS = [
  "title",
  "description",
  "keywords",
  "authors",
  "openGraph",
  "twitter",
  "alternates",
];

function readFileIfExists(filePath: string) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

export function validateHeadContract(repoRoot: string = process.cwd()): CheckResult {
  const errors: string[] = [];
  const rootLayoutPath = path.join(repoRoot, "src", "app", "layout.tsx");
  const themeProviderPath = path.join(repoRoot, "src", "components", "providers", "theme-provider.tsx");
  const appearanceRuntimePath = path.join(repoRoot, "src", "lib", "theme", "appearance.ts");

  const rootLayout = readFileIfExists(rootLayoutPath);
  if (!rootLayout) {
    errors.push("Missing root layout: src/app/layout.tsx");
    return { errors };
  }

  for (const key of ROOT_LAYOUT_DISALLOWED_METADATA_KEYS) {
    const pattern = new RegExp(`\\b${key}\\s*:`);
    if (pattern.test(rootLayout)) {
      errors.push(`src/app/layout.tsx must not own page metadata key "${key}".`);
    }
  }

  const themeColorOwnerCount = (rootLayout.match(/data-app-theme-color="true"/g) || []).length;
  if (themeColorOwnerCount !== 1) {
    errors.push(
      `src/app/layout.tsx must expose exactly one theme-color owner meta tag; found ${themeColorOwnerCount}.`,
    );
  }

  const themeProvider = readFileIfExists(themeProviderPath);
  if (!themeProvider.includes('meta[data-app-theme-color="true"]')) {
    errors.push(
      "src/components/providers/theme-provider.tsx must target meta[data-app-theme-color=\"true\"].",
    );
  }

  const appearanceRuntime = readFileIfExists(appearanceRuntimePath);
  if (!appearanceRuntime.includes('meta[data-app-theme-color="true"]')) {
    errors.push(
      "src/lib/theme/appearance.ts must target meta[data-app-theme-color=\"true\"].",
    );
  }

  return { errors };
}

function main() {
  const result = validateHeadContract(process.cwd());
  if (result.errors.length > 0) {
    console.error("[head-contract] violations detected:");
    for (const error of result.errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  console.log("[head-contract] ok");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
