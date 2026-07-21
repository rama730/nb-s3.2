import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("project detail header scroll behavior stays route-owned outside contained workspaces", () => {
    const source = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/dashboard/ProjectLayout.tsx"),
        "utf8",
    );

    assert.match(
        source,
        /const isContainedWorkspaceTab = isFilesTab \|\| isDocEditWorkspaceTab;/,
        "Files and Doc edit mode should use the contained full-height layout",
    );
    assert.doesNotMatch(
        source,
        /isFilesTab\s*\|\|\s*isSettingsTab/,
        "Settings should use the normal route scroll contract so the sticky project header works",
    );
    assert.doesNotMatch(
        source,
        /handleNestedScroll|handleWheel|nestedScrollTops/,
        "contained workspace panes should own their own scroll chrome",
    );
    assert.match(
        source,
        /h-0 -translate-y-2 opacity-0 pointer-events-none/,
        "route-scrolled pages should still smoothly collapse the top row",
    );
    assert.match(
        source,
        /isSettingsTab\s*\?\s*"w-full"/,
        "Settings should not create an internal tab-body scroll container",
    );
    assert.doesNotMatch(
        source,
        /isSettingsTab[\s\S]{0,120}overflow-y-auto/,
        "Settings must not bypass the route scroll root with its own overflow-y-auto wrapper",
    );
    assert.match(source, /isScrolled && "shadow-sm"/, "sticky header shadow should apply to all scroll sources");
});
