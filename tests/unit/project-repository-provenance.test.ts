import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    resolveProjectSocialLinks,
    type ProjectRepositoryContext,
} from "../../src/lib/projects/social-links";

test("scratch project without GitHub renders no integration repositories", () => {
    const context: ProjectRepositoryContext = {
        importSource: { type: "scratch" },
        githubSyncConnection: null,
    };
    const resolved = resolveProjectSocialLinks([], null, context);
    assert.equal(resolved.length, 0);
});

test("cloned project without active Files tab sync resolves exclusively as a cloned repository", () => {
    // Corresponds to Image 1: DietrichGebert/ponytail
    const context: ProjectRepositoryContext = {
        importSource: {
            type: "github",
            repoUrl: "https://github.com/DietrichGebert/ponytail",
            branch: "main",
        },
        githubSyncConnection: null,
    };
    const resolved = resolveProjectSocialLinks([], null, context);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, "github-cloned-repo");
    assert.equal(resolved[0].managed, "github-cloned-repo");
    assert.equal(resolved[0].repositoryRole, "cloned");
    assert.equal(resolved[0].accountLabel, "DietrichGebert/ponytail");
    assert.equal(resolved[0].url, "https://github.com/DietrichGebert/ponytail");
});

test("project with active Files tab sync resolves as a connected repository", () => {
    // Corresponds to Image 2: rama730/deepscope-ai
    const context: ProjectRepositoryContext = {
        importSource: null,
        githubSyncConnection: {
            repository: "rama730/deepscope-ai",
            branch: "main",
        },
    };
    const resolved = resolveProjectSocialLinks([], null, context);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, "github-sync-connection");
    assert.equal(resolved[0].managed, "github-sync-connection");
    assert.equal(resolved[0].repositoryRole, "connected");
    assert.equal(resolved[0].accountLabel, "rama730/deepscope ai");
    assert.equal(resolved[0].branch, "main");
});

test("hybrid edge case: cloned upstream + pushed to personal repo resolves both distinctly", () => {
    // User cloned DietrichGebert/ponytail, then connected and pushed rama730/ponytail in Files tab
    const context: ProjectRepositoryContext = {
        importSource: {
            type: "github",
            repoUrl: "https://github.com/DietrichGebert/ponytail",
            branch: "main",
        },
        githubSyncConnection: {
            repository: "rama730/ponytail",
            branch: "main",
        },
    };
    const resolved = resolveProjectSocialLinks([], null, context);
    assert.equal(resolved.length, 2);

    // Primary: Connected sync target
    assert.equal(resolved[0].id, "github-sync-connection");
    assert.equal(resolved[0].repositoryRole, "connected");
    assert.equal(resolved[0].accountLabel, "rama730/ponytail");

    // Secondary: Cloned upstream origin
    assert.equal(resolved[1].id, "github-cloned-repo");
    assert.equal(resolved[1].repositoryRole, "cloned");
    assert.equal(resolved[1].accountLabel, "DietrichGebert/ponytail");
});

test("connected and cloned repositories deduplicate user-managed duplicate links", () => {
    const context: ProjectRepositoryContext = {
        importSource: {
            type: "github",
            repoUrl: "https://github.com/DietrichGebert/ponytail",
        },
        githubSyncConnection: {
            repository: "rama730/ponytail",
            branch: "main",
        },
    };
    const userLinks = [
        { id: "manual-1", platform: "website", url: "https://github.com/rama730/ponytail" },
        { id: "manual-2", platform: "website", url: "https://behance.net/sample" },
    ];
    const resolved = resolveProjectSocialLinks(userLinks, null, context);
    assert.equal(resolved.length, 3);
    assert.equal(resolved[0].id, "github-sync-connection");
    assert.equal(resolved[1].id, "github-cloned-repo");
    assert.equal(resolved[2].id, "manual-2");
});

test("legacy fallback preserves backward compatibility when context is omitted", () => {
    const resolved = resolveProjectSocialLinks([], "https://github.com/owner/legacy");
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, "github-integration");
    assert.equal(resolved[0].managed, "github-integration");
    assert.equal(resolved[0].repositoryRole, "connected");
});

test("UI card contract: ProjectSocialLinksCard renders distinct badges and borders for cloned vs connected repositories", () => {
    const cardContent = readFileSync(
        path.join(process.cwd(), "src/components/projects/dashboard/ProjectSocialLinksCard.tsx"),
        "utf8",
    );
    assert.match(cardContent, /const label = isCloned \? 'Cloned repository' : 'Connected repository';/);
    assert.match(cardContent, /const badgeText = isCloned \? 'Cloned from GitHub' : 'Managed by integration';/);
    assert.match(cardContent, /data-testid=\{`project-managed-repo-\$\{repo\.id\}`\}/);
    assert.match(cardContent, /border-zinc-200 bg-zinc-50\/70/);
    assert.match(cardContent, /border-emerald-200 bg-emerald-50\/60/);
});

test("UI tooltip contract: ProjectLinkAnchor distinguishes cloned from connected repository tooltips", () => {
    const cardContent = readFileSync(
        path.join(process.cwd(), "src/components/projects/dashboard/ProjectSocialLinksCard.tsx"),
        "utf8",
    );
    assert.match(cardContent, /repoRoleLabel = link\.repositoryRole === 'cloned'/);
    assert.match(cardContent, /'\s*·\s*Cloned repository'/);
    assert.match(cardContent, /'\s*·\s*Connected repository'/);
});

test("/go route contract: route handler joins githubSyncConnections and resolves github-cloned-repo cleanly", () => {
    const routeContent = readFileSync(
        path.join(process.cwd(), "src/app/go/[ownerType]/[ownerId]/[linkKey]/route.ts"),
        "utf8",
    );
    assert.match(routeContent, /githubSyncConnections/);
    assert.match(routeContent, /leftJoin\(githubSyncConnections/);
    assert.match(routeContent, /importSource:/);
    assert.match(routeContent, /githubSyncConnection:/);
});

test("DTO contract: projectDetailProjectSchema includes githubSyncConnection to prevent safeParse stripping", () => {
    const actionsContent = readFileSync(
        path.join(process.cwd(), "src/app/actions/project/_all.ts"),
        "utf8",
    );
    assert.match(
        actionsContent,
        /githubSyncConnection:\s*z[\s\S]*?\.object\(\{[\s\S]*?repository:\s*z\.string\(\)[\s\S]*?branch:\s*z\.string\(\)[\s\S]*?\}\)[\s\S]*?\.nullable\(\)[\s\S]*?\.optional\(\)/,
    );
});

test("UI header contract: ProjectLinkCluster shows 5 links by default on desktop and 3 on tablet", () => {
    const cardContent = readFileSync(
        path.join(process.cwd(), "src/components/projects/dashboard/ProjectSocialLinksCard.tsx"),
        "utf8",
    );
    assert.match(cardContent, /resolved\.slice\(0,\s*5\)/);
    assert.match(cardContent, /index\s*>=\s*3\s*&&\s*'sm:hidden lg:inline-flex'/);
    assert.match(cardContent, /resolved\.slice\(3\)/);
    assert.match(cardContent, /resolved\.slice\(5\)/);
});

