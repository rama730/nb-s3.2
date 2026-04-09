import fs from "node:fs";
import path from "node:path";

type ValidationResult = {
  errors: string[];
  checkedFiles: number;
};

const REQUIRED_CANONICAL_MODULES = [
  "src/components/ui/UserAvatar.tsx",
  "src/lib/ui/identity.ts",
  "src/lib/ui/status-config.ts",
  "src/lib/profile/display.ts",
  "src/components/people/person-card-model.ts",
  "src/lib/import/import-filters.ts",
] as const;

const CANONICAL_AVATAR_SURFACES = [
  "src/components/layout/header/ProfileMenu.tsx",
  "src/components/profile/ProfileHeader.tsx",
  "src/components/profile/v2/ProfileHeader.tsx",
  "src/components/people/PersonCard.tsx",
  "src/components/people/ProfilePreviewDrawer.tsx",
  "src/components/chat/v2/MessageBubbleV2.tsx",
  "src/components/projects/ProjectCard.tsx",
  "src/components/settings/PrivacySettings.tsx",
] as const;

const USER_AVATAR_IMPORT_RE = /from\s+["']@\/components\/ui\/UserAvatar["']/;
const BANNED_AVATAR_PATTERNS: Array<{ re: RegExp; message: string }> = [
  {
    re: /getAvatarGradient\(/,
    message: "avatar gradients must come from UserAvatar/buildIdentityPresentation, not per-surface fallback logic.",
  },
  {
    re: /avatar(?:Url|_url)\s*\?/,
    message: "surface components must not branch on avatar URLs inline; use UserAvatar.",
  },
  {
    re: /substring\(0,\s*2\)\.toUpperCase\(\)/,
    message: "surface components must not hand-roll avatar initials; use UserAvatar/buildIdentityPresentation.",
  },
  {
    re: /app-accent-gradient/,
    message: "surface avatar fallbacks must use the canonical gradient contract instead of local accent-gradient fallbacks.",
  },
];

export function validateCanonicalLogicContract(rootDir: string = process.cwd()): ValidationResult {
  const errors: string[] = [];
  let checkedFiles = 0;

  for (const rel of REQUIRED_CANONICAL_MODULES) {
    if (!fs.existsSync(path.join(rootDir, rel))) {
      errors.push(`${rel}: required canonical module is missing.`);
    }
  }

  for (const rel of CANONICAL_AVATAR_SURFACES) {
    const absolute = path.join(rootDir, rel);
    if (!fs.existsSync(absolute)) continue;

    checkedFiles += 1;
    const source = fs.readFileSync(absolute, "utf8");

    if (!USER_AVATAR_IMPORT_RE.test(source)) {
      errors.push(`${rel}: first-wave avatar surfaces must import UserAvatar.`);
    }

    for (const pattern of BANNED_AVATAR_PATTERNS) {
      if (pattern.re.test(source)) {
        errors.push(`${rel}: ${pattern.message}`);
      }
    }
  }

  return { errors, checkedFiles };
}

function main() {
  const result = validateCanonicalLogicContract(process.cwd());
  if (result.errors.length > 0) {
    console.error("[canonical-logic-contract] violations detected:");
    for (const error of result.errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log(`[canonical-logic-contract] ok (${result.checkedFiles} first-wave surfaces checked)`);
}

if (require.main === module) {
  main();
}
