// V3-only Files tab entry contract.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DELETED_ADAPTER_PATH = path.resolve(
    __dirname,
    "../../../src/components/projects/v2/ProjectFilesWorkspace.tsx",
);
const REGISTRY_SRC = readFileSync(
    path.resolve(
        __dirname,
        "../../../src/components/projects/dashboard/ProjectTabsRegistry.tsx",
    ),
    "utf8",
);
const ROOT_SRC = readFileSync(
    path.resolve(
        __dirname,
        "../../../src/components/projects/v2/files-tab/FilesTabRoot.tsx",
    ),
    "utf8",
);

describe("Files tab entry — post-rollout source contract", () => {
    it("loads FilesTabRoot directly via `next/dynamic` with `ssr: false`", () => {
        assert.match(
            REGISTRY_SRC,
            /dynamic\(\s*\(\s*\)\s*=>\s*import\(\s*["']@\/components\/projects\/v2\/files-tab\/FilesTabRoot["']\s*\)\.then\(\(mod\)\s*=>\s*mod\.FilesTabRoot\)/,
        );
        assert.match(REGISTRY_SRC, /ssr:\s*false/);
    });

    it("deletes the adapter instead of preserving a pass-through wrapper", () => {
        assert.equal(
            existsSync(DELETED_ADAPTER_PATH),
            false,
            "ProjectFilesWorkspace should stay deleted; ProjectTabsRegistry owns the entry",
        );
    });

    it("does NOT import or reference the deleted WorkspaceShell module", () => {
        assert.doesNotMatch(
            REGISTRY_SRC + ROOT_SRC,
            /WorkspaceShell/,
            "post-rollout: WorkspaceShell must be entirely absent from the entry point",
        );
        assert.doesNotMatch(
            REGISTRY_SRC + ROOT_SRC,
            /workspace\/WorkspaceShell/,
            "post-rollout: no path reference to the deleted ./workspace/WorkspaceShell module",
        );
    });

    it("does NOT import `isFilesTabV3Enabled` (the flag has been deleted)", () => {
        // The entry point always renders FilesTabRoot unconditionally.
        assert.doesNotMatch(
            REGISTRY_SRC + ROOT_SRC,
            /isFilesTabV3Enabled/,
            "post-rollout: files entry should not consult the flag",
        );
    });

    it("does not accept the deleted V2-only props", () => {
        for (const prop of ["initialOpenLine", "initialOpenColumn", "initialFileNodes", "importSourceType"]) {
            assert.doesNotMatch(REGISTRY_SRC + ROOT_SRC, new RegExp(`\\b${prop}\\b`));
        }
    });
});
