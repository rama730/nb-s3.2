import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("GitHub Sync Destination Simplification & Inline Controls", () => {
  const workspacePath = path.resolve(
    process.cwd(),
    "src/components/projects/v2/files-tab/GitHubSyncWorkspace.tsx",
  );

  it("eliminates the full-page Change repository destination card when connection exists", () => {
    const source = readFileSync(workspacePath, "utf-8");

    // The old bulky card must NOT be rendered when state.connection exists
    assert.doesNotMatch(
      source,
      /state\.connection\s*&&\s*editingDestination/,
      "Must not render editingDestination card when connection is present",
    );

    // Initial setup card is strictly for unlinked projects
    assert.match(
      source,
      /!state\.connection\s*&&\s*setupMode\s*!==\s*null/,
      "Setup card should only appear for unlinked projects",
    );
  });

  it("provides inline Target Branch Switcher dropdown directly in the main header", () => {
    const source = readFileSync(workspacePath, "utf-8");

    // Must render details dropdown with branch icon and branch name
    assert.match(
      source,
      /<details className="relative group\/branch">/,
      "Must have an inline details dropdown for branch switching",
    );
    assert.match(
      source,
      /handleSwitchBranch\(b\)/,
      "Must call handleSwitchBranch on 1-click select",
    );
    assert.match(
      source,
      /Custom branch/,
      "Must offer custom branch creation option",
    );
  });

  it("provides compact Change Target Repository dialog directly from the main interface", () => {
    const source = readFileSync(workspacePath, "utf-8");

    // Must have changeRepoDialogOpen dialog
    assert.match(
      source,
      /<Dialog open=\{changeRepoDialogOpen\}/,
      "Must mount compact Change Target Repository Dialog",
    );
    assert.match(
      source,
      /Change Target Repository/,
      "Dialog title must be present",
    );
    assert.match(
      source,
      /handleSaveRepoUrl/,
      "Must save repository URL using handleSaveRepoUrl",
    );
  });
});
