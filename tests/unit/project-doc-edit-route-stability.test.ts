import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("project tabs use router-owned URL updates so Doc edit survives refreshes", () => {
    const dashboardClient = fs.readFileSync(
        path.join(repoRoot, "src/components/projects/dashboard/ProjectDashboardClient.tsx"),
        "utf8",
    );

    assert.match(
        dashboardClient,
        /router\.replace\(nextUrl,\s*\{\s*scroll:\s*false\s*\}\)/,
        "project tab URL changes should go through the Next router so server refreshes keep the active tab",
    );
    assert.doesNotMatch(
        dashboardClient,
        /window\.history\.replaceState\(window\.history\.state,\s*['"]['"],\s*nextUrl\)/,
        "project tabs must not preserve stale Next history state when changing tabs",
    );
    assert.doesNotMatch(
        dashboardClient,
        /Automatically purge tab-specific parameters from other tabs when activeTab changes/,
        "tab-specific URL cleanup must not be driven by optimistic activeTab state",
    );
    assert.match(
        dashboardClient,
        /clearProjectDetailScopedParams\(nextParams,\s*allowedTab\)/,
        "project detail URL cleanup should be derived from the allowed URL tab",
    );
    assert.match(
        dashboardClient,
        /normalizeProjectDetailTabParam\(searchTab\)/,
        "legacy docs/readme tab aliases should resolve through one canonical tab parser",
    );
});

test("project docs isolate document identity across URLs, cache, editor, and collaboration", () => {
    const docTab = fs.readFileSync(
        path.join(repoRoot, "src/components/projects/tabs/DocTab.tsx"),
        "utf8",
    );
    const draftEditorHook = fs.readFileSync(
        path.join(repoRoot, "src/components/projects/doc/useProjectDocDraftEditor.ts"),
        "utf8",
    );
    const collaborationHook = fs.readFileSync(
        path.join(repoRoot, "src/components/projects/doc/useDocCollaboration.ts"),
        "utf8",
    );
    const queryHook = fs.readFileSync(
        path.join(repoRoot, "src/hooks/hub/useProjectDocData.ts"),
        "utf8",
    );

    assert.match(
        docTab,
        /normalizeProjectDocSlug\(rawDocSlug\)/,
        "DocTab should normalize the URL doc slug before it reaches queries or server actions",
    );
    assert.match(
        docTab,
        /key=\{`\$\{projectId\}:\$\{docSlug\}:editor`\}/,
        "the document editor should remount when switching markdown documents",
    );
    assert.match(
        draftEditorHook,
        /project-doc-draft:\$\{projectId\}:\$\{normalizedDocSlug\}/,
        "local draft backups must be scoped by project and document slug",
    );
    assert.match(
        collaborationHook,
        /new Y\.Doc\(\), \[projectId, normalizedDocSlug\]/,
        "Yjs documents must be scoped by project and document slug",
    );
    assert.match(
        queryHook,
        /normalizeProjectDocSlug\(docSlug\)/,
        "React Query document keys should use the canonical document slug",
    );
});

test("project detail reads retry transient Supabase pooler DNS failures", () => {
    const projectActions = fs.readFileSync(
        path.join(repoRoot, "src/app/actions/project/_all.ts"),
        "utf8",
    );

    assert.match(
        projectActions,
        /PROJECT_DETAIL_TRANSIENT_DB_ERROR_CODES/,
        "project detail read path should classify transient DB connection failures",
    );
    assert.match(
        projectActions,
        /'ENOTFOUND'/,
        "project detail read retry should include DNS lookup failures from the Supabase pooler",
    );
    assert.match(
        projectActions,
        /retryProjectDetailRead\('resolve_project_detail_metadata_target'/,
        "project metadata resolution should retry transient read failures before returning an internal error",
    );
    assert.match(
        projectActions,
        /retryProjectDetailRead\('project_detail_shell_data'/,
        "project shell loading should retry transient read failures before the route throws",
    );
});
