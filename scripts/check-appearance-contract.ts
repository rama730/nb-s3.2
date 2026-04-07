import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CheckResult = {
  errors: string[];
};

const GRADIENT_ACTION_CLASS = "app-accent-gradient-horizontal";
const DISALLOWED_HARDCODED_ACCENT = /\b(?:bg|text|border|ring|from|to)-(?:blue|indigo|purple|violet|pink|fuchsia)-/;

const CORE_APPEARANCE_FILES = [
  "src/components/layout/header/NavLink.tsx",
  "src/components/layout/Sidebar.tsx",
  "src/components/layout/MobileNav.tsx",
  "src/components/hub/HubHeader.tsx",
  "src/components/chat/ChatPopup.tsx",
  "src/components/chat/MessageButton.tsx",
  "src/components/chat/MessageInput.tsx",
  "src/components/settings/AppearanceSettings.tsx",
  "src/components/projects/dashboard/ProjectLayout.tsx",
  "src/components/projects/v2/ProjectLayout.tsx",
  "src/components/projects/dashboard/ProjectOverviewCard.tsx",
  "src/components/projects/v2/TasksTab.tsx",
  "src/components/profile/ProfileHeader.tsx",
  "src/components/profile/v2/ProfileHeader.tsx",
];

function validateAppearanceContract(repoRoot: string = process.cwd()): CheckResult {
  const errors: string[] = [];

  for (const relPath of CORE_APPEARANCE_FILES) {
    const fullPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Missing appearance contract file: ${relPath}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf8");
    if (content.includes(GRADIENT_ACTION_CLASS)) {
      errors.push(`${relPath} uses ${GRADIENT_ACTION_CLASS}; action and selected states must stay solid/tinted, not gradient.`);
    }
    if (DISALLOWED_HARDCODED_ACCENT.test(content)) {
      errors.push(`${relPath} uses hardcoded blue/indigo/purple utility classes instead of semantic appearance tokens.`);
    }
  }

  return { errors };
}

function main() {
  const { errors } = validateAppearanceContract(process.cwd());
  if (errors.length > 0) {
    console.error("[appearance-contract] violations detected:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  console.log("[appearance-contract] ok");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export { validateAppearanceContract };
