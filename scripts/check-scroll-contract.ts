import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CheckResult = {
  errors: string[];
};

const MARKER_PATTERN = /(data-scroll-root=["']route["']|dataScrollRoot\b)/g;

const LEGACY_SCROLL_CLASS_PATTERN = /\b(custom-scrollbar|scrollbar-none|scrollbar-hide|scrollbar-thin)\b/g;

const LEGACY_CLASS_ALLOWLIST = new Set<string>([
  "src/components/projects/dashboard/ProjectLayout.tsx",
  "src/components/projects/v2/preview/AssetViewer.tsx",
  "src/components/projects/create-wizard/CreateProjectWizard.tsx",
  "src/components/projects/tabs/SprintPlanning.tsx",
  "src/components/projects/v2/tasks/TaskDetailPanel.tsx",
  "src/components/projects/v2/ProjectLayout.tsx",
]);

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function readFileIfExists(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function listPageFiles(baseDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === "page.tsx") {
        out.push(full);
      }
    }
  };
  if (fs.existsSync(baseDir)) walk(baseDir);
  return out;
}

function collectAncestorLayouts(pageFile: string, mainDir: string): string[] {
  const layouts: string[] = [];
  let current = path.dirname(pageFile);
  while (current.startsWith(mainDir)) {
    const layoutFile = path.join(current, "layout.tsx");
    if (fs.existsSync(layoutFile)) layouts.push(layoutFile);
    if (current === mainDir) break;
    current = path.dirname(current);
  }
  return layouts;
}

function collectExtraContractFiles(pageFile: string, repoRoot: string): string[] {
  const rel = toPosix(path.relative(repoRoot, pageFile));
  const extras: string[] = [];

  if (rel === "src/app/(main)/hub/page.tsx") {
    extras.push(path.join(repoRoot, "src/components/hub/SimpleHubClient.tsx"));
  }
  if (rel === "src/app/(main)/workspace/page.tsx") {
    extras.push(path.join(repoRoot, "src/components/workspace/WorkspaceClient.tsx"));
  }
  if (rel.startsWith("src/app/(main)/settings/")) {
    extras.push(path.join(repoRoot, "src/components/settings/SettingsLayout.tsx"));
  }

  return extras.filter((file) => fs.existsSync(file));
}

function countRouteMarkers(files: string[]): number {
  let count = 0;
  for (const file of files) {
    const content = readFileIfExists(file);
    const matches = content.match(MARKER_PATTERN);
    count += matches ? matches.length : 0;
  }
  return count;
}

function checkGlobalsCss(globalsPath: string): string[] {
  const errors: string[] = [];
  const css = readFileIfExists(globalsPath);
  if (!css) return errors;

  if (/\*::-webkit-scrollbar/.test(css)) {
    errors.push("Forbidden global scrollbar selector found in src/app/globals.css: '*::-webkit-scrollbar'.");
  }
  if (/\*\s*\{[^}]*scrollbar-color\s*:/.test(css)) {
    errors.push("Forbidden global scrollbar-color on '*' found in src/app/globals.css.");
  }

  return errors;
}

function checkSmoothScrollHtmlContract(repoRoot: string, globalsPath: string): string[] {
  const errors: string[] = [];
  const css = readFileIfExists(globalsPath);
  if (!/html\s*\{[^}]*scroll-behavior\s*:\s*smooth/i.test(css)) {
    return errors;
  }

  const rootLayoutPath = path.join(repoRoot, "src", "app", "layout.tsx");
  const rootLayout = readFileIfExists(rootLayoutPath);
  if (!rootLayout.includes('data-scroll-behavior="smooth"')) {
    errors.push(
      "src/app/layout.tsx must set data-scroll-behavior=\"smooth\" when global smooth scroll is enabled.",
    );
  }

  return errors;
}

function checkLegacyScrollClasses(srcDir: string, repoRoot: string): string[] {
  const errors: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !/\.(ts|tsx|js|jsx|css)$/.test(entry.name)) continue;
      const rel = toPosix(path.relative(repoRoot, full));
      const content = fs.readFileSync(full, "utf8");
      LEGACY_SCROLL_CLASS_PATTERN.lastIndex = 0;
      if (!LEGACY_SCROLL_CLASS_PATTERN.test(content)) continue;
      LEGACY_SCROLL_CLASS_PATTERN.lastIndex = 0;
      if (LEGACY_CLASS_ALLOWLIST.has(rel)) continue;
      errors.push(`Legacy scrollbar utility detected in non-allowlisted file: ${rel}`);
    }
  };
  if (fs.existsSync(srcDir)) walk(srcDir);
  return errors;
}

export function validateScrollContract(repoRoot: string = process.cwd()): CheckResult {
  const errors: string[] = [];
  const mainDir = path.join(repoRoot, "src", "app", "(main)");
  const globalsPath = path.join(repoRoot, "src", "app", "globals.css");
  const srcDir = path.join(repoRoot, "src");

  const pageFiles = listPageFiles(mainDir);
  for (const pageFile of pageFiles) {
    const candidateFiles = [
      pageFile,
      ...collectAncestorLayouts(pageFile, mainDir),
      ...collectExtraContractFiles(pageFile, repoRoot),
    ];
    const uniqueFiles = Array.from(new Set(candidateFiles));
    const markerCount = countRouteMarkers(uniqueFiles);
    if (markerCount !== 1) {
      const relPage = toPosix(path.relative(repoRoot, pageFile));
      const relSources = uniqueFiles.map((file) => toPosix(path.relative(repoRoot, file))).join(", ");
      errors.push(
        `${relPage} must resolve to exactly one route scroll root marker; found ${markerCount}. Sources checked: ${relSources}`,
      );
    }
  }

  errors.push(...checkGlobalsCss(globalsPath));
  errors.push(...checkSmoothScrollHtmlContract(repoRoot, globalsPath));
  errors.push(...checkLegacyScrollClasses(srcDir, repoRoot));

  return { errors };
}

function main() {
  const result = validateScrollContract(process.cwd());
  if (result.errors.length > 0) {
    console.error("[scroll-contract] violations detected:");
    for (const error of result.errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  console.log("[scroll-contract] ok");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
