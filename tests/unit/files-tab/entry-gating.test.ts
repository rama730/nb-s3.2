// Post-rollout entry-gating contract for `ProjectFilesWorkspace`.
//
// Task 13.4's deletion sweep removed the legacy `WorkspaceShell` branch
// and the `isFilesTabV3Enabled` flag. This test now pins the simplified
// shape: `ProjectFilesWorkspace` is a pure forwarder that always mounts
// `FilesTabRoot` via `next/dynamic` and runs every prop bag through
// `adaptToV3Props`.
//
// We keep the (1) pure-function exercise of `adaptToV3Props` (its
// contract did not change) and (2) the source-level structural contract
// — but swap the dual-branch assertions for single-branch ones.
// The runtime-gating section (which loaded the module twice with the
// flag flipped) is gone because there is no flag to flip.
//
// Validates: design § Migration and Rollout / Phase 4 (post-deletion).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// (1) Pure-function exercise: `adaptToV3Props`
// ---------------------------------------------------------------------------

import {
    adaptToV3Props,
    type ProjectFilesWorkspaceProps,
} from "@/components/projects/v2/ProjectFilesWorkspace";

describe("adaptToV3Props — prop adapter contract", () => {
    const baseProps: ProjectFilesWorkspaceProps = {
        projectId: "proj-1",
        projectName: "My Project",
        currentUserId: "user-1",
        isOwnerOrMember: true,
        isActive: true,
        syncStatus: "ready",
        importSourceType: "github",
        initialOpenPath: "src/app.ts",
        initialOpenLine: 42,
        initialOpenColumn: 7,
        initialFileNodes: [],
    };

    it("drops `initialOpenLine` and `initialOpenColumn` (V3 has no line targeting)", () => {
        const v3 = adaptToV3Props(baseProps);
        assert.equal(
            Object.prototype.hasOwnProperty.call(v3, "initialOpenLine"),
            false,
            "initialOpenLine must not appear on the V3 prop bag",
        );
        assert.equal(
            Object.prototype.hasOwnProperty.call(v3, "initialOpenColumn"),
            false,
            "initialOpenColumn must not appear on the V3 prop bag",
        );
    });

    it("drops `initialFileNodes` and `importSourceType` (not on the V3 surface)", () => {
        const v3 = adaptToV3Props(baseProps);
        assert.equal(
            Object.prototype.hasOwnProperty.call(v3, "initialFileNodes"),
            false,
        );
        assert.equal(
            Object.prototype.hasOwnProperty.call(v3, "importSourceType"),
            false,
        );
    });

    it("passes `initialOpenPath` through unchanged", () => {
        const v3 = adaptToV3Props(baseProps);
        assert.equal(v3.initialOpenPath, "src/app.ts");
    });

    it("normalises a missing `initialOpenPath` to `null` (V3 resolver contract)", () => {
        const v3 = adaptToV3Props({
            ...baseProps,
            initialOpenPath: undefined,
        });
        assert.equal(v3.initialOpenPath, null);
    });

    it("forwards the core identity + role props verbatim", () => {
        const v3 = adaptToV3Props(baseProps);
        assert.equal(v3.projectId, baseProps.projectId);
        assert.equal(v3.projectName, baseProps.projectName);
        assert.equal(v3.currentUserId, baseProps.currentUserId);
        assert.equal(v3.isOwnerOrMember, baseProps.isOwnerOrMember);
        assert.equal(v3.isActive, baseProps.isActive);
        assert.equal(v3.syncStatus, baseProps.syncStatus);
    });

    it("is pure — repeated calls with the same input produce deep-equal output", () => {
        const a = adaptToV3Props(baseProps);
        const b = adaptToV3Props(baseProps);
        assert.deepEqual(a, b);
    });
});

// ---------------------------------------------------------------------------
// (2) Source-level structural contract (post-deletion shape)
// ---------------------------------------------------------------------------

const ENTRY_PATH = path.resolve(
    __dirname,
    "../../../src/components/projects/v2/ProjectFilesWorkspace.tsx",
);
const ENTRY_SRC = readFileSync(ENTRY_PATH, "utf8");

describe("ProjectFilesWorkspace — post-rollout source contract", () => {
    it("declares the V3 FilesTabRoot via `next/dynamic` with `ssr: false`", () => {
        assert.match(
            ENTRY_SRC,
            /const\s+FilesTabRoot\s*=\s*dynamic\(\s*\(\s*\)\s*=>\s*import\(\s*["']\.\/files-tab\/FilesTabRoot["']\s*\)/,
        );
        assert.match(ENTRY_SRC, /ssr:\s*false/);
    });

    it("uses exactly one `dynamic()` loader (the WorkspaceShell branch is gone)", () => {
        const declarations =
            ENTRY_SRC.match(/^\s*const\s+\w+\s*=\s*dynamic\(/gm) ?? [];
        assert.equal(
            declarations.length,
            1,
            `expected exactly 1 \`const X = dynamic(\` declaration, found ${declarations.length}`,
        );
    });

    it("does NOT import or reference the deleted WorkspaceShell module", () => {
        assert.doesNotMatch(
            ENTRY_SRC,
            /WorkspaceShell/,
            "post-rollout: WorkspaceShell must be entirely absent from the entry point",
        );
        assert.doesNotMatch(
            ENTRY_SRC,
            /workspace\/WorkspaceShell/,
            "post-rollout: no path reference to the deleted ./workspace/WorkspaceShell module",
        );
    });

    it("does NOT import `isFilesTabV3Enabled` (the flag has been deleted)", () => {
        // The entry point always renders FilesTabRoot unconditionally.
        assert.doesNotMatch(
            ENTRY_SRC,
            /isFilesTabV3Enabled/,
            "post-rollout: ProjectFilesWorkspace should not consult the flag",
        );
    });

    it("renders `<FilesTabRoot {...adaptToV3Props(props)} />` unconditionally", () => {
        assert.match(
            ENTRY_SRC,
            /return\s*<FilesTabRoot\s+\{\.\.\.adaptToV3Props\(props\)\}\s*\/>/,
        );
    });

    it("exports `adaptToV3Props` so downstream callers and this test can exercise the adapter", () => {
        assert.match(ENTRY_SRC, /export\s+function\s+adaptToV3Props\s*\(/);
    });
});
