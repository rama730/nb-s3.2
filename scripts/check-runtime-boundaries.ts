import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const ALLOWED_SUPABASE_CHANNEL_FILES = new Set([
  "src/lib/realtime/subscriptions.ts",
]);

function toPosix(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function listSourceFiles(baseDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(baseDir);
  return out;
}

function extractFunctionBody(source: string, functionName: string) {
  const signature = new RegExp(`export\\s+async\\s+function\\s+${functionName}\\s*\\(`);
  const signatureMatch = signature.exec(source);
  if (!signatureMatch) return null;

  const openBraceIndex = source.indexOf("{", signatureMatch.index);
  if (openBraceIndex < 0) return null;

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex, index + 1);
      }
    }
  }

  return null;
}

function extractConstArrowBody(source: string, constName: string) {
  const signature = new RegExp(`export\\s+const\\s+${constName}\\s*=\\s*cache\\s*\\(\\s*async\\s*\\(`);
  const signatureMatch = signature.exec(source);
  if (!signatureMatch) return null;

  const openBraceIndex = source.indexOf("{", signatureMatch.index);
  if (openBraceIndex < 0) return null;

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex, index + 1);
      }
    }
  }

  return null;
}

function main() {
  const errors: string[] = [];

  const sourceFiles = listSourceFiles(path.join(REPO_ROOT, "src"));
  for (const absoluteFile of sourceFiles) {
    const rel = toPosix(path.relative(REPO_ROOT, absoluteFile));
    const content = fs.readFileSync(absoluteFile, "utf8");
    if (content.includes(".channel(") && !ALLOWED_SUPABASE_CHANNEL_FILES.has(rel)) {
      errors.push(`Direct Supabase channel usage is only allowed in approved wrappers (${rel}).`);
    }
  }

  const workspaceActionsPath = path.join(REPO_ROOT, "src", "app", "actions", "workspace.ts");
  const workspaceActions = fs.readFileSync(workspaceActionsPath, "utf8");
  if (/export\s+async\s+function\s+getWorkspaceOverview\s*\(/.test(workspaceActions)) {
    errors.push("Legacy getWorkspaceOverview export is forbidden; workspace bootstrap must use profile counters only.");
  }
  const workspaceOverviewBaseBody = extractFunctionBody(workspaceActions, "getWorkspaceOverviewBase");
  if (workspaceOverviewBaseBody && /count\(\*\)/i.test(workspaceOverviewBaseBody)) {
    errors.push("getWorkspaceOverviewBase must not perform live aggregate count(*) queries.");
  }

  const profileDataPath = path.join(REPO_ROOT, "src", "lib", "data", "profile.ts");
  const profileData = fs.readFileSync(profileDataPath, "utf8");
  const bootstrapProfileBody = extractConstArrowBody(profileData, "getUserProfile");
  if (bootstrapProfileBody && /\.select\(\s*['"`]\*['"`]\s*\)/.test(bootstrapProfileBody)) {
    errors.push("getUserProfile must not use wildcard profile selects; authenticated shell bootstrap must stay explicit and bounded.");
  }

  const mainLayoutPath = path.join(REPO_ROOT, "src", "app", "(main)", "layout.tsx");
  const mainLayout = fs.readFileSync(mainLayoutPath, "utf8");
  if (mainLayout.includes("getViewerProfileContext")) {
    errors.push("Main route layout must not fetch the full viewer profile on every render; bootstrap from auth snapshot only.");
  }

  const inngestRoutePath = path.join(REPO_ROOT, "src", "app", "api", "v1", "inngest", "route.ts");
  const inngestRoute = fs.readFileSync(inngestRoutePath, "utf8");
  if (!inngestRoute.includes("getRegisteredInngestFunctions")) {
    errors.push("Inngest route must register functions through getRegisteredInngestFunctions().");
  }
  if (/project-import|git-sync/.test(inngestRoute)) {
    errors.push("Inngest route must not import worker-only functions directly.");
  }

  if (errors.length > 0) {
    console.error("[runtime-boundaries] violations detected:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log("[runtime-boundaries] ok");
}

main();
