import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateAppearanceContract } from "../../scripts/check-appearance-contract";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

const requiredFiles = [
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
  "src/components/workspace/WorkspaceTabBar.tsx",
];

describe("check-appearance-contract script", () => {
  it("passes when core appearance files use semantic tokens", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "appearance-contract-pass-"));
    for (const filePath of requiredFiles) {
      write(path.join(tmp, filePath), `export const ok = "app-selected-surface app-accent-solid text-primary";`);
    }

    const result = validateAppearanceContract(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails when a core file reintroduces gradient-action or hardcoded accent classes", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "appearance-contract-fail-"));
    for (const filePath of requiredFiles) {
      write(path.join(tmp, filePath), `export const ok = "app-selected-surface";`);
    }
    write(
      path.join(tmp, "src/components/hub/HubHeader.tsx"),
      `export const bad = "app-accent-gradient-horizontal bg-indigo-600 text-white";`,
    );

    const result = validateAppearanceContract(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("app-accent-gradient-horizontal")));
    assert.ok(result.errors.some((line) => line.includes("hardcoded blue/indigo/purple utility classes")));
  });
});
