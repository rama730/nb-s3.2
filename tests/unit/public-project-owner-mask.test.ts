import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPublicProjectToHubProject } from "@/lib/projects/public-feed";

describe("public project owner masking", () => {
    it("masks non-public owners in cached public feed items", () => {
        const project = mapPublicProjectToHubProject({
            id: "project-1",
            slug: "project-1",
            title: "Project",
            description: "Desc",
            short_description: "Short",
            category: "Project",
            skills: [],
            tags: [],
            status: "active",
            visibility: "public",
            owner_id: "owner-1",
            view_count: 12,
            followers_count: 3,
            saves_count: 0,
            cover_image: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            open_roles: [{
                id: "role-1",
                project_id: "project-1",
                role: "Frontend Engineer",
                title: "Frontend Engineer",
                description: null,
                count: 2,
                filled: 1,
                skills: ["React"],
            }],
            profiles: {
                id: "owner-1",
                username: "owner",
                full_name: "Owner Name",
                avatar_url: "https://example.com/a.png",
                visibility: "private",
            },
        });

        assert.equal(project.owner?.displayName, "Private creator");
        assert.equal(project.owner?.isMasked, true);
        assert.equal(project.owner?.canOpenProfile, false);
        assert.equal(project.owner?.username, null);
        assert.equal(project.openRoles?.length, 1);
        assert.equal(project.openRoles?.[0]?.role, "Frontend Engineer");
        assert.equal(project.openRoles?.[0]?.filled, 1);
    });
});
