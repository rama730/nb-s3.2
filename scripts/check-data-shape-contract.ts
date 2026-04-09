import fs from "node:fs";
import path from "node:path";

type ValidationOptions = {
  strict?: boolean;
};

type ValidationResult = {
  errors: string[];
  warnings: string[];
  checkedFiles: number;
};

const LEGACY_SNAKE_CASE_COMPONENT_ALLOWLIST = new Set([
  "src/components/hub/SimpleHubClient.tsx",
  "src/components/profile/ProfileForm.tsx",
  "src/components/profile/edit/EditProfileModal.tsx",
  "src/components/profile/edit/EditProfileTabs.tsx",
  "src/components/profile/v2/sections/ActivityFeedContainer.tsx",
  "src/components/projects/v2/tasks/CreateTaskModal.tsx",
  "src/components/projects/v2/tasks/TaskCard.tsx",
  "src/components/projects/v2/tasks/TaskDetailTabs/CommentsTab.tsx",
  "src/components/projects/v2/tasks/TaskDetailTabs/DetailsTab.tsx",
  "src/components/projects/v2/tasks/TasksTable.tsx",
  "src/components/providers/AuthProvider.tsx",
]);

const DISALLOWED_SURFACE_TOKENS_RE = /\b(full_name|avatar_url|social_links|availability_status|experience_level|open_to|banner_url)\b/;

function toPosix(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function collectComponentFiles(dir: string, into: string[]) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectComponentFiles(full, into);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".tsx")) {
      into.push(full);
    }
  }
}

export function validateDataShapeContract(
  rootDir: string = process.cwd(),
  options: ValidationOptions = {},
): ValidationResult {
  const files: string[] = [];
  collectComponentFiles(path.join(rootDir, "src", "components"), files);

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const absolute of files) {
    const rel = toPosix(path.relative(rootDir, absolute));
    const source = fs.readFileSync(absolute, "utf8");
    if (!DISALLOWED_SURFACE_TOKENS_RE.test(source)) continue;

    if (LEGACY_SNAKE_CASE_COMPONENT_ALLOWLIST.has(rel)) {
      warnings.push(
        `${rel}: legacy snake_case surface remains allowlisted; migrate this component to normalized view models before Phase 2.`,
      );
      continue;
    }

    errors.push(`${rel}: direct snake_case identity/profile fields are forbidden in component surfaces.`);
  }

  if (options.strict && warnings.length > 0) {
    errors.push(
      ...warnings.map((warning) =>
        warning.replace("legacy snake_case surface remains allowlisted; ", "strict mode forbids allowlisted legacy surface: "),
      ),
    );
  }

  return {
    errors,
    warnings,
    checkedFiles: files.length,
  };
}

function main() {
  const strict = process.argv.includes("--strict");
  const result = validateDataShapeContract(process.cwd(), { strict });

  if (result.warnings.length > 0) {
    console.warn("[data-shape-contract] legacy surface warnings:");
    for (const warning of result.warnings) {
      console.warn(` - ${warning}`);
    }
  }

  if (result.errors.length > 0) {
    console.error("[data-shape-contract] violations detected:");
    for (const error of result.errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `[data-shape-contract] ok (${result.checkedFiles} component surfaces checked, ${result.warnings.length} legacy allowlisted)`,
  );
}

if (require.main === module) {
  main();
}
