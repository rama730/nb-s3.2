import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { User } from "@supabase/supabase-js";
import { buildIntegrationsData } from "@/lib/settings/integrations";
import type { GithubLinkedProject } from "@/lib/types/settingsTypes";

function mockUser(overrides: Partial<User>): User {
  return {
    id: "user-1",
    app_metadata: { provider: "github", providers: ["github"] },
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-03-20T00:00:00.000Z",
    email: "user@example.com",
    email_confirmed_at: "2026-03-20T00:00:00.000Z",
    identities: [{ provider: "github", identity_data: { login: "octocat" } }],
    ...overrides,
  } as User;
}

describe("GitHub Card Redesign & Integrations Settings Contract", () => {
  it("buildIntegrationsData includes linked/cloned github projects in githubService", () => {
    const mockProjects: GithubLinkedProject[] = [
      {
        id: "proj-1",
        slug: "cloned-starter",
        title: "Cloned Starter",
        importSource: { type: "github", repoUrl: "https://github.com/facebook/react" },
        githubRepoUrl: null,
        syncRepository: null,
        syncBranch: null,
        lastSyncAt: null,
      },
      {
        id: "proj-2",
        slug: "synced-app",
        title: "Synced App",
        importSource: null,
        githubRepoUrl: "https://github.com/octocat/synced-app",
        syncRepository: "octocat/synced-app",
        syncBranch: "main",
        lastSyncAt: "2026-04-01T10:00:00.000Z",
      },
      {
        id: "proj-3",
        slug: "hybrid-repo",
        title: "Hybrid Repo",
        importSource: { type: "github", repoUrl: "https://github.com/vercel/next.js" },
        githubRepoUrl: "https://github.com/octocat/hybrid-repo",
        syncRepository: "octocat/hybrid-repo",
        syncBranch: "prod",
        lastSyncAt: "2026-04-02T12:00:00.000Z",
      },
    ];

    const data = buildIntegrationsData({
      user: mockUser({}),
      githubRepoProjectCount: mockProjects.length,
      githubLastSyncAt: "2026-04-02T12:00:00.000Z",
      passwordLastChangedAt: null,
      githubProjects: mockProjects,
    });

    assert.equal(data.githubService.usageCount, 3);
    assert.equal(data.githubService.status, "connected");
    assert.equal(data.githubService.projects?.length, 3);
    assert.equal(data.githubService.projects?.[0].slug, "cloned-starter");
    assert.equal(data.githubService.projects?.[1].syncRepository, "octocat/synced-app");
    assert.equal(data.githubService.projects?.[2].syncBranch, "prod");
  });

  it("IntegrationsSettings eliminates the 404 /projects link and provides inline expansion", () => {
    const filePath = path.resolve(process.cwd(), "src/components/settings/IntegrationsSettings.tsx");
    const content = fs.readFileSync(filePath, "utf-8");

    // The broken 404 link to /projects must not exist
    assert.ok(!content.includes('href="/projects"'), "Must not link to non-existent /projects route");

    // Must use projectsExpanded state
    assert.ok(content.includes("projectsExpanded"), "Must manage projectsExpanded state");
    assert.ok(content.includes("setProjectsExpanded"), "Must provide toggle for projectsExpanded");

    // Must link each project to its slug: /projects/${project.slug}
    assert.ok(content.includes("`/projects/${project.slug}`"), "Must link to valid /projects/[slug] route");

    // Must render badges for cloned and synced repositories
    assert.ok(content.includes("Cloned repository"), "Must render 'Cloned repository' badge");
    assert.ok(content.includes("GitHub sync"), "Must render 'GitHub sync' badge");

    // Must have spacing container between commit attribution card and projects card
    assert.ok(
      content.includes('<div className="space-y-4">\n        <GitHubCommitAttributionSettings />'),
      "Must have space-y-4 container between commit attribution and projects card",
    );
  });

  it("GitHubCommitAttributionSettings is clean, always open, shows active author identity without redundant buttons", () => {
    const filePath = path.resolve(process.cwd(), "src/components/settings/GitHubCommitAttributionSettings.tsx");
    const content = fs.readFileSync(filePath, "utf-8");

    // Accordion details/summary should be eliminated
    assert.ok(!content.includes("<details"), "Must not hide settings behind <details> accordion");
    assert.ok(!content.includes("<summary"), "Must not have <summary> tag");

    // Must display active commit author
    assert.ok(content.includes("Active commit author:"), "Must display active commit author label");

    // Redundant 'Select another verified email' button must be removed to avoid confusion
    assert.ok(!content.includes("Select another verified email"), "Must remove redundant 'Select another verified email' button");

    // Must render privacy-safe noreply badge and connected status
    assert.ok(content.includes("Privacy-safe noreply"), "Must display privacy-safe noreply badge");
    assert.ok(content.includes("Connected"), "Must display Connected badge");
  });

  it("API route selects cloned repos and synced connections with high-performance query", () => {
    const filePath = path.resolve(process.cwd(), "src/app/api/v1/integrations/route.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // Joins githubSyncConnections
    assert.ok(content.includes("leftJoin(githubSyncConnections"), "Must leftJoin githubSyncConnections");
    assert.ok(content.includes("projects.importSource"), "Must check projects.importSource for cloned repos");
    assert.ok(content.includes("githubProjects"), "Must build and return githubProjects list");
  });
});
