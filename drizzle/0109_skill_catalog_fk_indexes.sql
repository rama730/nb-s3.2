-- Foreign-key support indexes for catalog moderation and lifecycle operations.
CREATE INDEX IF NOT EXISTS "skills_replacement_skill_id_idx"
    ON "skills" ("replacement_skill_id");

CREATE INDEX IF NOT EXISTS "skill_catalog_releases_published_by_idx"
    ON "skill_catalog_releases" ("published_by");

CREATE INDEX IF NOT EXISTS "skill_proposals_resolved_skill_id_idx"
    ON "skill_proposals" ("resolved_skill_id");

CREATE INDEX IF NOT EXISTS "skill_proposals_reviewed_by_idx"
    ON "skill_proposals" ("reviewed_by");

CREATE INDEX IF NOT EXISTS "profile_contribution_skills_verified_by_idx"
    ON "profile_contribution_skills" ("verified_by");
