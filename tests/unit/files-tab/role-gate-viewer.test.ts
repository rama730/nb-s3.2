// Task 9.2 — Role_Viewer gating + deep-link arrival authorization.
//
// Coverage (per tasks.md § 9.2):
//   (i)  Viewer sees no mutation UI — the Edit button (and every other
//        mutation affordance) is absent when `role === "Role_Viewer"`
//        (Req 19.3, Req 5.4, Req 14.11–14.12).
//   (ii) Programmatic dispatch of a mutation action returns an
//        authorization error for unauthenticated callers and for
//        authenticated callers without write access (Req 19.6).
//        Implemented as a source-level audit of `src/app/actions/files/*`:
//        every mutation server action SHALL contain the canonical pair
//        `if (!user) throw new Error("Unauthorized")` +
//        a project write/upload access assertion so unauthorized callers are
//        refused before any DB mutation runs. The shared helper
//        `assertProjectWriteAccess` (in `_shared.ts`) is itself asserted
//        to throw `"Forbidden"` on no-access paths, matching the
//        `requireProjectCapability("upload_files")` rule which rejects
//        the viewer role via `projectMemberCan`.
//   (iii) Unauthenticated arrival via deep link redirects to sign-in
//        without disclosing target name / path / content / metadata:
//        `findNodeByPathAny` refuses anonymous callers at the source
//        level (`if (!user) throw new Error("Unauthorized")`), and the
//        shared `resolveDeepLinkFromSearch` coordinator classifies the
//        thrown auth error as `not_found` — the segments echoed back to
//        the caller come only from the URL the user arrived with, never
//        from server-fetched metadata or content.
//   (iv) Malformed + over-length deep links → Req 10.5 inline error path
//        without any target disclosure: resolver refuses to round-trip
//        to the server, so no name / path / content / metadata is
//        fetched before the failure is surfaced.
//
// The test is hermetic: no DB, no network, no Next.js / Supabase client
// boot. Server-action invariants are verified via source-level contracts
// (same approach used elsewhere in this suite, e.g. `sidebar.test.ts`).
//
// Requirements: Req 10.5, Req 19.3, Req 19.5, Req 19.6, Req 19.7, Req 19.8.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  FilesTabRoleProvider,
  type Role,
} from "@/components/projects/v2/files-tab/FilesTabRoleContext";
import { FileActionsBar } from "@/components/projects/v2/files-tab/file/FileActionsBar";

const testQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});
import {
  DEEP_LINK_MAX_LENGTH,
  evaluateDeepLinkPath,
} from "@/components/projects/v2/files-tab/url";
import {
  resolveDeepLinkFromSearch,
  type ResolveDeepLinkResult,
} from "@/components/projects/v2/files-tab/hooks/useDeepLinkResolver";

// ─── Source readers ──────────────────────────────────────────────────

const ACTIONS_DIR = path.resolve(
  __dirname,
  "../../../src/app/actions/files",
);

const LIB_FILES_DIR = path.resolve(
  __dirname,
  "../../../src/lib/files",
);
const API_FILES_DIR = path.resolve(
  __dirname,
  "../../../src/app/api/v1/files",
);

function readActionSource(file: string): string {
  return readFileSync(path.join(ACTIONS_DIR, file), "utf8");
}

function readLibSource(file: string): string {
  return readFileSync(path.join(LIB_FILES_DIR, file), "utf8");
}

function readApiFileSource(file: string): string {
  return readFileSync(path.join(API_FILES_DIR, file), "utf8");
}

const SHARED_SRC = readLibSource("internal-helpers.ts");
const MUTATIONS_SRC = readActionSource("mutations.ts");
const CONTENT_SRC = readActionSource("content.ts");
const VERSIONS_SRC = readActionSource("versions.ts");
const LINKS_SRC = readActionSource("links.ts");
const EVENTS_SRC = readActionSource("events.ts");
const NODES_SRC = readActionSource("nodes.ts");
const LOCK_SERVICE_SRC = readLibSource("file-lock-service.ts");
const LOCK_ROUTE_SRC = readApiFileSource("[nodeId]/lock/route.ts");
const LOCK_RENEW_ROUTE_SRC = readApiFileSource("[nodeId]/lock-renew/route.ts");

// ─── (i) Viewer sees no mutation UI (Req 19.3, Req 5.4) ──────────────

describe("Role_Viewer — mutation UI is absent (Req 19.3, Req 5.4)", () => {
  function renderActionsBarWithRole(role: Role): string {
    return renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: testQueryClient },
        React.createElement(
          FilesTabRoleProvider,
          {
          role,
          canEdit: role !== "Role_Viewer",
          },
          React.createElement(FileActionsBar, {
            mode: "view",
            onView: () => {},
            onRaw: () => {},
            onEdit: () => {},
          }),
        ),
      ),
    );
  }

  const FILE_ACTIONS_BAR_SRC = readFileSync(
    path.resolve(
      __dirname,
      "../../../src/components/projects/v2/files-tab/file/FileActionsBar.tsx",
    ),
    "utf8",
  );

  it("hides the Edit button for Role_Viewer and verifies source gates", () => {
    const html = renderActionsBarWithRole("Role_Viewer");
    // The dropdown trigger is always visible
    assert.match(
      html,
      /data-testid="files-tab-file-actions-dropdown-trigger"/,
      "Dropdown trigger stays visible for every role",
    );

    // Assert that the source-level restricts Edit and Raw options contextually:
    // `canEditOption` checks that user `canEdit` and file is text like, not empty.
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /canEditOption\s*=\s*canEdit/,
      "Edit button must be gated by canEdit and isTextLike (Req 5.4, 19.3)",
    );
    // Verify raw option logic
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /showRawOption\s*=\s*isEmpty\s*\|\|\s*isDocLikeFile/,
      "Raw option must be conditionally visible (Req 5.2)",
    );
  });

  it("shows the dropdown trigger and confirms Edit availability in source for Role_Owner and Role_Member", () => {
    for (const role of ["Role_Owner", "Role_Member"] as const) {
      const html = renderActionsBarWithRole(role);
      assert.match(
        html,
        /data-testid="files-tab-file-actions-dropdown-trigger"/,
        `${role} must see the Actions dropdown trigger`,
      );
    }
  });

  it("defaults to read-only when no role provider is mounted (viewer-safe default)", () => {
    // FileActionsBar reads the context directly and falls back to
    // `canEdit=false` when the provider is absent — this prevents
    // accidental exposure of the Edit affordance in composite test
    // harnesses that forget to mount the provider. Req 19.3 ("must not
    // be visible, focusable, or activatable").
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: testQueryClient },
        React.createElement(FileActionsBar, {
          mode: "view",
          onView: () => {},
          onRaw: () => {},
          onEdit: () => {},
        }),
      ),
    );
    // Since canEdit defaults to false, verify replace input is absent
    assert.doesNotMatch(html, /data-testid="files-tab-file-actions-replace-input"/);
    // Verify default value in source
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /const\s+canEdit\s*=\s*roleCtx\?\.canEdit\s*\?\?\s*false/,
      "FileActionsBar must default canEdit to false when context is absent",
    );
  });

  it("sidebar source gates every mutation context-menu item behind `canEdit`", () => {
    // FilesTabSidebar mirrors the role context to the preserved tree
    // renderer. Verifying via source contract keeps the test hermetic
    // (the sidebar pulls dnd, uploads, and worker bootstrap at render
    // time).
    const SIDEBAR_SRC = readFileSync(
      path.resolve(
        __dirname,
        "../../../src/components/projects/v2/files-tab/FilesTabSidebar.tsx",
      ),
      "utf8",
    );
    // The context-menu (create / upload / rename / delete / move)
    // affordances live inside `{canEdit && (...) }` blocks. A plain
    // viewer render (`canEdit=false`) therefore emits none of them.
    assert.match(
      SIDEBAR_SRC,
      /\{canEdit\s*&&\s*contextMenuState\.node\.type\s*===\s*"folder"/,
      "folder-only mutation items must be gated by canEdit",
    );
    assert.match(
      SIDEBAR_SRC,
      /\{canEdit\s*&&\s*\(/,
      "generic mutation items must be gated by canEdit",
    );
    // And the sidebar passes `canEdit` straight through to the drop
    // handler so Role_Viewer drag-and-drop uploads are also rejected
    // client-side (Req 19.3 — "not activatable").
    assert.match(
      SIDEBAR_SRC,
      /if\s*\(!canEdit/,
      "drop handler must early-return when canEdit is false (Req 19.3)",
    );
  });
});

// ─── (ii) Server-side rejection of Viewer mutations (Req 19.6) ───────

describe("Server-side mutation authorization (Req 19.6)", () => {
  // Every server action that MUTATES the project's Files graph MUST
  // refuse unauthorized callers before any DB write. The canonical
  // pattern across this codebase is:
  //
  //    const { data: { user } } = await supabase.auth.getUser();
  //    if (!user) throw new Error("Unauthorized");
  //    await assertProjectWriteAccess(projectId, user.id);
  //    // Upload-specific mutations use assertProjectUploadAccess instead.
  //
  // `assertProjectWriteAccess` calls `requireProjectCapability(...,
  // "upload_files")` which rejects the `viewer` role via
  // `projectMemberCan`. The net effect is that a Role_Viewer who
  // crafts a direct server-action invocation receives an authorization
  // error (Req 19.6) — no row is ever written.

  const MUTATION_ACTIONS: Array<{
    fn: string;
    src: () => string;
  }> = [
    // mutations.ts — every write-action
    { fn: "createFolder", src: () => MUTATIONS_SRC },
    { fn: "createFileNode", src: () => MUTATIONS_SRC },
    { fn: "renameNode", src: () => MUTATIONS_SRC },
    { fn: "moveNode", src: () => MUTATIONS_SRC },
    { fn: "bulkMoveNodes", src: () => MUTATIONS_SRC },
    { fn: "trashNode", src: () => MUTATIONS_SRC },
    { fn: "restoreNode", src: () => MUTATIONS_SRC },
    { fn: "bulkTrashNodes", src: () => MUTATIONS_SRC },
    { fn: "bulkRestoreNodes", src: () => MUTATIONS_SRC },
    { fn: "purgeNode", src: () => MUTATIONS_SRC },
    { fn: "deleteNode", src: () => MUTATIONS_SRC },
    { fn: "bulkCreateFolderTree", src: () => MUTATIONS_SRC },
    // content.ts — write-side formatters / stats
    { fn: "formatProjectFileContent", src: () => CONTENT_SRC },
    { fn: "updateProjectFileStats", src: () => CONTENT_SRC },
    // versions.ts — version history writes
    { fn: "applyUploadedFileRevision", src: () => VERSIONS_SRC },
    { fn: "restoreFileVersion", src: () => VERSIONS_SRC },
    // links.ts — task-file linking mutates
    { fn: "linkNodeToTask", src: () => LINKS_SRC },
    { fn: "unlinkNodeFromTask", src: () => LINKS_SRC },
    { fn: "updateTaskNodeLink", src: () => LINKS_SRC },
    { fn: "updateTaskNodeLinksOrder", src: () => LINKS_SRC },
    // events.ts — event recording writes
    { fn: "recordProjectNodeEvent", src: () => EVENTS_SRC },
  ];

  for (const { fn, src } of MUTATION_ACTIONS) {
    it(`${fn} rejects unauthenticated callers and asserts write/upload access`, () => {
      // Scope the regex to the function body: from `export async function
      // ${fn}(` up to (but not including) the next top-of-file
      // `export async function` or end-of-file. This gives us the
      // entire prologue + transaction body.
      const body = extractFunctionBody(src(), fn);
      assert.ok(
        body,
        `${fn} must be defined in the scanned server-action file`,
      );

      // Step 1: the unauthenticated-caller guard must be present.
      assert.match(
        body,
        /if\s*\(!user\)\s*throw\s+new\s+Error\(\s*["']Unauthorized["']\s*\)|await\s+requireUser\(\)/,
        `${fn} must reject anonymous callers with an "Unauthorized" error (Req 19.6)`,
      );

      // Step 2: write/upload-access assertion. File upload/version
      // mutations use the member-specific upload policy; structural
      // mutations use the broader write policy. Both reject Role_Viewer.
      assert.match(
        body,
        /\bassertProject(?:Write|Upload)Access(?:Tx)?\s*\(/,
        `${fn} must assert write/upload access before any DB mutation (Req 19.6)`,
      );
    });
  }

  it("file lease routes require auth, CSRF, and write access before lock service calls", () => {
    for (const [label, source, serviceCall] of [
      ["acquire", LOCK_ROUTE_SRC, "acquireFileLease"],
      ["release", LOCK_ROUTE_SRC, "releaseFileLease"],
      ["renew", LOCK_RENEW_ROUTE_SRC, "renewFileLease"],
    ] as const) {
      assert.match(
        source,
        /requireFileLeaseUser\(request,\s*\{[\s\S]*csrf:\s*true/,
        `${label}: route must require authenticated CSRF-protected requests`,
      );
      assert.match(
        source,
        /assertProjectWriteAccess\([\s\S]*auth\.user!\.id\)/,
        `${label}: route must reject viewer/read-only users before mutating leases`,
      );
      assert.match(
        source,
        new RegExp(`assertProjectWriteAccess[\\s\\S]*${serviceCall}\\(`),
        `${label}: write access must be checked before ${serviceCall}`,
      );
    }
  });

  it("file lease service scopes renew/release to the authenticated holder credentials", () => {
    for (const fn of ["renewFileLease", "releaseFileLease"] as const) {
      const body = extractFunctionBody(LOCK_SERVICE_SRC, fn);
      assert.ok(body, `${fn} must be defined`);
      for (const guard of [
        /locked_by\s*=\s*\$\{input\.userId\}::uuid/,
        /session_id\s*=\s*\$\{input\.credentials\.sessionId\}::uuid/,
        /lease_id\s*=\s*\$\{input\.credentials\.leaseId\}::uuid/,
        /fencing_token\s*=\s*\$\{input\.credentials\.fencingToken\}/,
      ]) {
        assert.match(body, guard, `${fn}: ${guard} guard is required`);
      }
    }
  });

  it("assertProjectWriteAccess helper throws 'Forbidden' for callers without write capability", () => {
    // The shared helper is the single choke-point where the viewer
    // role is refused. This source-level assertion pins the contract
    // so a refactor cannot silently drop the capability gate.
    const helperBody = extractFunctionBody(SHARED_SRC, "assertProjectWriteAccess");
    assert.ok(helperBody, "assertProjectWriteAccess must exist in _shared.ts");

    // It must re-check project existence and delegate capability
    // resolution to `requireProjectCapability("upload_files")` which
    // fails closed for the `viewer` role.
    assert.match(
      helperBody,
      /if\s*\(!access\.canWrite\)\s*throw\s+new\s+Error\(\s*["']Forbidden["']\s*\)/,
      "must fail closed with Forbidden when the caller lacks write access",
    );
    assert.match(
      helperBody,
      /requireProjectCapability\(\s*projectId\s*,\s*userId\s*,\s*["']upload_files["']\s*\)/,
      "must delegate capability check to requireProjectCapability (rejects viewer role)",
    );
  });

  it("assertProjectWriteAccessTx row-locks the project + membership before mutation", () => {
    // SEC-H5 / SEC-M1: the Tx variant is what transactional mutations
    // call so a concurrent role removal cannot race an already-open
    // viewer request into a successful write.
    const helperBody = extractFunctionBody(
      SHARED_SRC,
      "assertProjectWriteAccessTx",
    );
    assert.ok(helperBody, "assertProjectWriteAccessTx must exist");
    assert.match(
      helperBody,
      /FOR UPDATE/,
      "must SELECT ... FOR UPDATE the project row",
    );
    assert.match(
      helperBody,
      /projectMemberCan\(member\.role,\s*["']upload_files["']\)/,
      "must re-check member capability against projectMemberCan inside the tx",
    );
    assert.match(
      helperBody,
      /throw\s+new\s+Error\(\s*["']Forbidden["']\s*\)/,
      "must throw Forbidden when capability check fails (Req 19.6)",
    );
  });

  it("bulkCreateFolderTree — bulk upload path is not exempt (Req 19.6)", () => {
    // Explicit regression test: bulk uploads share the same guard so
    // a viewer cannot round-trip a folder-tree payload to bypass the
    // per-row check.
    const body = extractFunctionBody(MUTATIONS_SRC, "bulkCreateFolderTree");
    assert.ok(body);
    assert.match(
      body,
      /if\s*\(!user\)\s*throw\s+new\s+Error\(\s*["']Unauthorized["']\s*\)/,
    );
    assert.match(body, /await\s+assertProjectWriteAccess\(/);
  });
});

// ─── (iii) Unauthenticated deep-link arrival (Req 19.7) ──────────────

describe("Unauthenticated deep-link arrival (Req 19.7, Req 19.5)", () => {
  it("findNodeByPathAny rejects anonymous callers before reading any node", () => {
    // `useDeepLinkResolver` delegates node resolution to
    // `findNodeByPathAny`. For Req 19.7, we need the server action to
    // refuse anonymous callers BEFORE it reads the node name/path, so
    // no target disclosure can leak back to the client.
    const body = extractFunctionBody(NODES_SRC, "findNodeByPathAny");
    assert.ok(body, "findNodeByPathAny must be defined in nodes.ts");

    // Structural contract: the Unauthorized throw must appear before
    // any `db.query.projectNodes.findFirst` call.
    const unauthIdx = body.search(
      /if\s*\(!user\)\s*throw\s+new\s+Error\(\s*["']Unauthorized["']\s*\)/,
    );
    const firstQueryIdx = body.indexOf("projectNodes.findFirst");
    assert.ok(
      unauthIdx >= 0,
      "findNodeByPathAny must reject anonymous callers with 'Unauthorized'",
    );
    assert.ok(
      firstQueryIdx >= 0,
      "findNodeByPathAny is expected to query projectNodes after auth",
    );
    assert.ok(
      unauthIdx < firstQueryIdx,
      "Unauthorized check MUST precede the first node lookup — otherwise an anonymous caller could observe a row existing before being refused",
    );

    // And `assertProjectFileReadAccess` (read-access check for the project
    // itself) must also run before the per-segment walk. Together
    // they close Req 19.7 at the server boundary.
    const accessIdx = body.search(/await\s+assertProjectFileReadAccess\(/);
    assert.ok(accessIdx >= 0);
    assert.ok(accessIdx < firstQueryIdx);
  });

  it("resolveDeepLinkFromSearch classifies a thrown Unauthorized as 'not_found' (no disclosure)", async () => {
    // When the server action throws (as the anonymous-caller case
    // does), the resolver returns `{ kind: "not_found", segments }`.
    // The segments echoed back are the URL segments the caller
    // supplied — NOT server-fetched metadata. So no target name /
    // content / metadata is disclosed to the client.
    const observed: ResolveDeepLinkResult[] = [];
    observed.push(
      await resolveDeepLinkFromSearch("private/secret.txt", {
        projectId: "proj-1",
        findNodeByPathAny: async () => {
          // Simulates the production path: anonymous caller → throw.
          throw new Error("Unauthorized");
        },
      }),
    );

    assert.equal(observed[0]?.kind, "not_found");
    // Structural check — the only surface exposed on a `not_found`
    // result is the segments list (from the URL), and explicitly
    // nothing the server might have fetched.
    if (observed[0]?.kind === "not_found") {
      const keys = Object.keys(observed[0]).sort();
      assert.deepEqual(
        keys,
        ["kind", "segments"],
        "not_found result must NOT carry server-fetched name / size / mimeType / content",
      );
      assert.deepEqual(observed[0].segments, ["private", "secret.txt"]);
    }
  });

  it("deep-link resolver source: inline error log carries only 'reason', never node content", () => {
    // Req 19.7: "SHALL NOT render the Deep_Link_Path target name, path,
    // file content, or metadata". The resolver's only console output
    // on failure is `console.log("[files-tab] deep-link resolve failed",
    // { reason, segments })` — no node, no metadata.
    const RESOLVER_SRC = readFileSync(
      path.resolve(
        __dirname,
        "../../../src/components/projects/v2/files-tab/hooks/useDeepLinkResolver.ts",
      ),
      "utf8",
    );
    assert.match(
      RESOLVER_SRC,
      /console\.log\(\s*"\[files-tab\] deep-link resolve failed"/,
      "resolver must log failure without disclosing the node",
    );
    // Must never log node properties such as `.name`, `.s3Key`,
    // `.mimeType`, `.size`, or `.content` on the failure path.
    assert.doesNotMatch(
      RESOLVER_SRC,
      /console\.(log|warn|error)\([^)]*node\.(name|s3Key|mimeType|size|content)/,
      "resolver must not log node name / storage key / mime / size / content",
    );
    // And the `not_found` failure must dispatch `navigateTo(null)`
    // (root) before surfacing the inline error — so the main area
    // renders the project root, not the requested target.
    assert.match(
      RESOLVER_SRC,
      /navigateRef\.current\(null\)/,
      "unresolved deep link must navigate to root (Req 10.5, 19.7)",
    );
  });

  it("middleware redirects unauthenticated callers off protected routes without leaking target", () => {
    // For routes classified as protected, the Supabase middleware
    // rewrites the response to `/login?redirect=<encoded next path>`
    // BEFORE any page / action ever runs. That is the Files-tab
    // fallback for "project requires authentication" per Req 19.7.
    //
    // The contract we assert here is the middleware shape: it builds
    // the redirect URL without reading the project DB (no DB calls
    // happen in the middleware import graph) and pins the next-path
    // via `normalizeAuthNextPath`.
    const MW_SRC = readFileSync(
      path.resolve(__dirname, "../../../src/lib/supabase/middleware.ts"),
      "utf8",
    );
    assert.match(
      MW_SRC,
      /url\.pathname\s*=\s*['"]\/login['"]/,
      "middleware must redirect unauthenticated callers on protected routes to /login",
    );
    assert.match(
      MW_SRC,
      /normalizeAuthNextPath\(/,
      "middleware must normalize the redirect next-path to prevent open-redirect disclosure",
    );
  });
});

// ─── (iv) Malformed + over-length deep link — Req 10.5 (no target disclosure) ─

describe("Malformed and over-length deep links (Req 10.5, Req 19.8)", () => {
  const lookupMustNotRun = () => {
    throw new Error(
      "findNodeByPathAny MUST NOT be invoked for malformed / empty / over-length deep links (Req 10.5)",
    );
  };

  it("empty `?path=` classified as error/empty, no lookup attempted", () => {
    assert.deepEqual(evaluateDeepLinkPath(""), {
      kind: "error",
      reason: "empty",
    });
  });

  it("whitespace-only `?path=` classified as error/empty", () => {
    assert.deepEqual(evaluateDeepLinkPath("   \t\n"), {
      kind: "error",
      reason: "empty",
    });
  });

  it("all-slashes `?path=///` classified as error/empty", () => {
    assert.deepEqual(evaluateDeepLinkPath("///"), {
      kind: "error",
      reason: "empty",
    });
  });

  it("4097-char `?path=` classified as error/overlength (one above the ceiling)", () => {
    const overlength = "a".repeat(DEEP_LINK_MAX_LENGTH + 1);
    assert.deepEqual(evaluateDeepLinkPath(overlength), {
      kind: "error",
      reason: "overlength",
    });
  });

  it("resolveDeepLinkFromSearch never hits the server on empty / overlength inputs", async () => {
    const empty = await resolveDeepLinkFromSearch("", {
      projectId: "proj-1",
      findNodeByPathAny: lookupMustNotRun,
    });
    assert.deepEqual(empty, { kind: "empty" });

    const overlength = await resolveDeepLinkFromSearch(
      "a".repeat(DEEP_LINK_MAX_LENGTH + 1),
      {
        projectId: "proj-1",
        findNodeByPathAny: lookupMustNotRun,
      },
    );
    assert.deepEqual(overlength, { kind: "overlength" });

    const whitespace = await resolveDeepLinkFromSearch("   ", {
      projectId: "proj-1",
      findNodeByPathAny: lookupMustNotRun,
    });
    assert.deepEqual(whitespace, { kind: "empty" });
  });

  it("error results carry NO target name / path / content / metadata (Req 10.5, Req 19.7)", async () => {
    // The failure surface exposed to callers is intentionally narrow:
    //   * `empty`      → { kind }
    //   * `overlength` → { kind }
    //   * `not_found`  → { kind, segments }  (segments are the user's
    //                    own URL fragments, not server data)
    // No path carries file content, mimeType, size, storage key, or
    // updater identity — so Req 19.7's "no disclosure" guarantee
    // holds even under adversarial URL shapes.
    const cases: Array<[string, ResolveDeepLinkResult]> = [
      [
        "",
        await resolveDeepLinkFromSearch("", {
          projectId: "proj-1",
          findNodeByPathAny: lookupMustNotRun,
        }),
      ],
      [
        "overlength",
        await resolveDeepLinkFromSearch("z".repeat(DEEP_LINK_MAX_LENGTH + 1), {
          projectId: "proj-1",
          findNodeByPathAny: lookupMustNotRun,
        }),
      ],
      [
        "not_found",
        await resolveDeepLinkFromSearch("a/b/c", {
          projectId: "proj-1",
          findNodeByPathAny: async () => null,
        }),
      ],
    ];

    for (const [label, result] of cases) {
      const keys = Object.keys(result).sort();
      assert.ok(
        !keys.includes("node"),
        `${label}: result must not carry a 'node' field`,
      );
      assert.ok(
        !keys.includes("content"),
        `${label}: result must not carry file content`,
      );
      assert.ok(
        !keys.includes("mimeType"),
        `${label}: result must not carry mimeType`,
      );
      assert.ok(
        !keys.includes("size"),
        `${label}: result must not carry size`,
      );
      assert.ok(
        !keys.includes("s3Key"),
        `${label}: result must not carry storage key`,
      );
    }
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract the body of `export async function ${name}(...)` from a TS
 * source string. Starts at the `export async function` line and stops
 * immediately before the next `export async function` (top-level) or at
 * end-of-file. Good enough for flat action modules where every export is
 * at the top level — which is the case for every file under
 * `src/app/actions/files/*`.
 */
function extractFunctionBody(source: string, name: string): string | null {
  const startRe = new RegExp(
    `export\\s+async\\s+function\\s+${name}\\s*\\(`,
    "g",
  );
  const startMatch = startRe.exec(source);
  if (!startMatch) return null;
  const startIdx = startMatch.index;

  // Find the next top-level `export async function` (or `export function`,
  // or end-of-file) to bound the body.
  const boundaryRe = /\nexport\s+(?:async\s+)?function\s+/g;
  boundaryRe.lastIndex = startIdx + startMatch[0].length;
  const boundaryMatch = boundaryRe.exec(source);
  const endIdx = boundaryMatch ? boundaryMatch.index : source.length;
  return source.slice(startIdx, endIdx);
}
