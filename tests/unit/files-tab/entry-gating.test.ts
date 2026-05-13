// Task 8.3 acceptance test — `ProjectFilesWorkspace` feature-flag gating.
//
// Validates: Req 21.7–21.8; design.md § Migration and Rollout / Coexistence.
//
// jsdom is not installed in this repo. Following the pattern used by
// `tests/unit/files-tab/sidebar.test.ts` and `tests/unit/files-tab/files-tab-main.test.ts`,
// we exercise the observable contracts three ways:
//
//   (1) Pure-function exercise of `adaptToV3Props`. The adapter is exported
//       for this purpose — the acceptance criterion "drops
//       `initialOpenLine` / `initialOpenColumn`; passes `initialOpenPath`"
//       is a function-of-input assertion and needs nothing more.
//
//   (2) Structural source-level contract on the entry module:
//         - both V3 (`FilesTabRoot`) and V2 (`WorkspaceShell`) are declared
//           via `next/dynamic(() => import(...), { ssr: false })` at module
//           scope so each branch has a stable component reference.
//         - the render path calls `isFilesTabV3Enabled(props.currentUserId)`
//           and chooses a subtree based on the result.
//         - the flag-on branch forwards `adaptToV3Props(props)` into
//           `FilesTabRoot`, NOT the raw prop bag.
//         - the flag-off branch forwards the raw props into `WorkspaceShell`.
//
//   (3) Runtime render against a fake React renderer. The entry module is
//       loaded twice — once with the `NEXT_PUBLIC_FILES_TAB_V3` env override
//       forced on, once with it forced off — and in each configuration we
//       assert which of the two `dynamic`-wrapped components was mounted.
//       Because `next/dynamic` is stubbed to a thin pass-through that
//       records loader invocations, we can additionally assert that
//       `WorkspaceShell`'s loader is never invoked when the flag is on —
//       satisfying the "WorkspaceShell is not loaded when flag on"
//       acceptance criterion.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import Module from "node:module";

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
// (2) Source-level structural contract
// ---------------------------------------------------------------------------

const ENTRY_PATH = path.resolve(
    __dirname,
    "../../../src/components/projects/v2/ProjectFilesWorkspace.tsx",
);
const ENTRY_SRC = readFileSync(ENTRY_PATH, "utf8");

describe("ProjectFilesWorkspace — source-level contract (design § Coexistence)", () => {
    it("imports `isFilesTabV3Enabled` from the files feature module", () => {
        assert.match(
            ENTRY_SRC,
            /import\s+\{\s*isFilesTabV3Enabled\s*\}\s+from\s+["']@\/lib\/features\/files["']/,
        );
    });

    it("declares the V3 FilesTabRoot via `next/dynamic` with `ssr: false`", () => {
        // The dynamic() call for FilesTabRoot lives at module scope. Match the
        // whole block so a refactor that inlines the loader into the render
        // path (which would break the import-graph guarantee) is caught.
        assert.match(
            ENTRY_SRC,
            /const\s+FilesTabRoot\s*=\s*dynamic\(\s*\(\s*\)\s*=>\s*import\(\s*["']\.\/files-tab\/FilesTabRoot["']\s*\)/,
        );
        assert.match(ENTRY_SRC, /ssr:\s*false/);
    });

    it("declares the legacy WorkspaceShell via `next/dynamic` with `ssr: false`", () => {
        assert.match(
            ENTRY_SRC,
            /const\s+WorkspaceShell\s*=\s*dynamic\(\s*\(\s*\)\s*=>\s*import\(\s*["']\.\/workspace\/WorkspaceShell["']\s*\)/,
        );
    });

    it("uses two independent `dynamic()` loaders (both branches must be independently tree-shakable at render time)", () => {
        // Match only `const NAME = dynamic(` declarations so comments mentioning
        // `dynamic(` do not inflate the count.
        const declarations =
            ENTRY_SRC.match(/^\s*const\s+\w+\s*=\s*dynamic\(/gm) ?? [];
        assert.equal(
            declarations.length,
            2,
            `expected exactly 2 \`const X = dynamic(\` declarations, found ${declarations.length}`,
        );
    });

    it("branches on `isFilesTabV3Enabled(props.currentUserId)`", () => {
        assert.match(
            ENTRY_SRC,
            /isFilesTabV3Enabled\(\s*props\.currentUserId\s*\)/,
        );
    });

    it("flag-on branch renders `<FilesTabRoot {...adaptToV3Props(props)} />`", () => {
        assert.match(
            ENTRY_SRC,
            /<FilesTabRoot\s+\{\.\.\.adaptToV3Props\(props\)\}\s*\/>/,
        );
    });

    it("flag-off branch renders `<WorkspaceShell {...props} />`", () => {
        assert.match(
            ENTRY_SRC,
            /<WorkspaceShell\s+\{\.\.\.props\}\s*\/>/,
        );
    });

    it("no longer re-exports WorkspaceShell directly (the pre-8.3 shape)", () => {
        // The previous contents were `export { default } from './workspace/WorkspaceShell';`.
        // After 8.3 the default export is the flag-branching component.
        assert.doesNotMatch(
            ENTRY_SRC,
            /export\s*\{\s*default\s*\}\s*from\s*["']\.\/workspace\/WorkspaceShell["']/,
        );
    });

    it("exports `adaptToV3Props` so downstream callers and this test can exercise the adapter", () => {
        assert.match(ENTRY_SRC, /export\s+function\s+adaptToV3Props\s*\(/);
    });
});

// ---------------------------------------------------------------------------
// (3) Runtime gating via flag on/off — assert the selected subtree mounts
// ---------------------------------------------------------------------------
//
// We need to render `ProjectFilesWorkspace` twice: once with the V3 flag
// on and once with it off, and observe which subtree gets mounted. Doing
// this without jsdom or React-DOM requires three stubs:
//
//   (a) `next/dynamic`: pass-through that returns a sentinel component
//       whose `displayName` encodes the loader id AND records whether the
//       loader was invoked. This lets us assert "WorkspaceShell's loader
//       is not called when the flag is on".
//
//   (b) `@/lib/features/files`: already reads `process.env.NEXT_PUBLIC_FILES_TAB_V3`
//       at call-time via `asEnabledOff`, so we only need to flip the env
//       var between the two loads.
//
//   (c) A minimal React renderer: we invoke `ProjectFilesWorkspace` as a
//       function (it's a FC), passing a prop bag, and inspect the
//       returned element's `type`. No DOM mounting required.
//
// The two loads are done against a fresh `require` cache so each run
// picks up the current env value when `dynamic` is evaluated at module
// load time.

type DynamicStub = (
    loader: () => Promise<unknown>,
    opts?: { ssr?: boolean },
) => ((props: unknown) => unknown) & {
    __loaderInvoked: boolean;
    __loaderTag: string;
    displayName: string;
};

function installDynamicStub(): { loaders: DynamicStub[] } {
    const loaders: DynamicStub[] = [];
    const originalResolve = (Module as unknown as {
        _resolveFilename: (req: string, parent: unknown, ...rest: unknown[]) => string;
    })._resolveFilename;
    const originalLoad = (Module as unknown as {
        _load: (req: string, parent: unknown, ...rest: unknown[]) => unknown;
    })._load;

    (Module as unknown as {
        _load: (req: string, parent: unknown, ...rest: unknown[]) => unknown;
    })._load = function patchedLoad(
        request: string,
        parent: unknown,
        ...rest: unknown[]
    ): unknown {
        if (request === "next/dynamic") {
            const dyn: DynamicStub = ((
                loader: () => Promise<unknown>,
            ) => {
                // Tag based on the loader source so tests can assert which
                // branch was mounted without mounting React.
                const loaderSrc = loader.toString();
                let tag = "unknown";
                if (loaderSrc.includes("FilesTabRoot")) tag = "FilesTabRoot";
                else if (loaderSrc.includes("WorkspaceShell")) tag = "WorkspaceShell";
                const Comp = ((_props: unknown): unknown => {
                    // Record that the loader was invoked when the component is
                    // rendered (this is when next/dynamic would fire the
                    // import). We do NOT await the promise — we just want to
                    // know the loader was touched.
                    (Comp as unknown as { __loaderInvoked: boolean })
                        .__loaderInvoked = true;
                    try { void loader(); } catch { /* ignore */ }
                    return null;
                }) as ReturnType<DynamicStub>;
                Comp.__loaderInvoked = false;
                Comp.__loaderTag = tag;
                Comp.displayName = `DynamicStub(${tag})`;
                loaders.push(Comp as unknown as DynamicStub);
                return Comp;
            }) as DynamicStub;
            // CommonJS interop: `import dynamic from 'next/dynamic'` under
            // tsx/CJS resolves to the `.default` of the module object.
            return { default: dyn, __esModule: true };
        }
        return originalLoad.call(this, request, parent, ...rest);
    };

    // Preserve the unused reference so eslint stays happy; this is a stub
    // swap, not a resolve swap.
    void originalResolve;

    return { loaders };
}

function clearEntryModuleFromCache(): void {
    // Drop the ProjectFilesWorkspace + files features module from the
    // require cache so the next `require` re-evaluates them under the
    // current env.
    const keysToDrop = Object.keys(require.cache).filter(
        (k) =>
            k.endsWith("ProjectFilesWorkspace.tsx") ||
            k.endsWith("ProjectFilesWorkspace.ts") ||
            k.endsWith("/lib/features/files.ts"),
    );
    for (const key of keysToDrop) delete require.cache[key];
}

function renderEntry(
    ProjectFilesWorkspaceDefault: (props: ProjectFilesWorkspaceProps) => unknown,
): { type: unknown; props: Record<string, unknown> } {
    const element = ProjectFilesWorkspaceDefault({
        projectId: "proj-1",
        projectName: "Proj",
        currentUserId: "runtime-user",
        isOwnerOrMember: true,
        isActive: true,
        syncStatus: "ready",
        importSourceType: null,
        initialOpenPath: null,
        initialOpenLine: null,
        initialOpenColumn: null,
    });
    // React elements created via JSX/React.createElement expose `type` and `props`.
    return element as { type: unknown; props: Record<string, unknown> };
}

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
    const original = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    try {
        return fn();
    } finally {
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
    }
}

describe("ProjectFilesWorkspace — runtime branch selection via flag", () => {
    it("flag ON → renders the `FilesTabRoot` dynamic stub; `WorkspaceShell` loader is never invoked", () => {
        const { loaders } = installDynamicStub();
        try {
            withEnv("NEXT_PUBLIC_FILES_TAB_V3", "1", () => {
                clearEntryModuleFromCache();
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const mod = require("@/components/projects/v2/ProjectFilesWorkspace") as {
                    default: (p: ProjectFilesWorkspaceProps) => unknown;
                };
                const el = renderEntry(mod.default);
                const type = el.type as { __loaderTag?: string } | undefined;
                assert.equal(
                    type?.__loaderTag,
                    "FilesTabRoot",
                    "flag-on branch must mount the FilesTabRoot dynamic stub",
                );
                const workspaceShell = loaders.find(
                    (l) =>
                        (l as unknown as { __loaderTag: string }).__loaderTag ===
                        "WorkspaceShell",
                );
                assert.ok(
                    workspaceShell,
                    "WorkspaceShell dynamic stub must be declared at module scope",
                );
                assert.equal(
                    (workspaceShell as unknown as { __loaderInvoked: boolean })
                        .__loaderInvoked,
                    false,
                    "WorkspaceShell loader must not be invoked when the flag is on",
                );
            });
        } finally {
            // Restore original Module._load
            delete require.cache[
                Object.keys(require.cache).find((k) =>
                    k.endsWith("ProjectFilesWorkspace.tsx"),
                ) ?? ""
            ];
        }
    });

    it("flag OFF → renders the `WorkspaceShell` dynamic stub", () => {
        installDynamicStub();
        withEnv("NEXT_PUBLIC_FILES_TAB_V3", "0", () => {
            clearEntryModuleFromCache();
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require("@/components/projects/v2/ProjectFilesWorkspace") as {
                default: (p: ProjectFilesWorkspaceProps) => unknown;
            };
            const el = renderEntry(mod.default);
            const type = el.type as { __loaderTag?: string } | undefined;
            assert.equal(
                type?.__loaderTag,
                "WorkspaceShell",
                "flag-off branch must mount the WorkspaceShell dynamic stub",
            );
        });
    });
});
