import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("project detail header scroll behavior is shared by Files and Settings tabs", () => {
    const source = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/dashboard/ProjectLayout.tsx"),
        "utf8",
    );

    assert.match(
        source,
        /const isContainedWorkspaceTab = isFilesTab;/,
        "only the Files workspace should use the contained full-height layout",
    );
    assert.doesNotMatch(
        source,
        /isFilesTab\s*\|\|\s*isSettingsTab/,
        "Settings should use the normal route scroll contract so the sticky project header works",
    );
    assert.match(
        source,
        /layoutRoot\?\.addEventListener\("scroll", handleNestedScroll, \{ capture: true, passive: true \}\)/,
        "contained workspace scroll panes should feed the shared header scroll state",
    );
    assert.match(
        source,
        /h-0 -translate-y-2 opacity-0 pointer-events-none/,
        "the contained Files header should smoothly collapse when its inner pane scrolls",
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
