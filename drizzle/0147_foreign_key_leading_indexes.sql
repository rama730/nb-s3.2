-- Foreign-key indexes keep delete/update checks bounded as these tables grow.
-- Each statement is intentionally additive and safe to re-run.
CREATE INDEX IF NOT EXISTS "conversation_participants_last_reaction_actor_idx"
    ON "conversation_participants" ("last_reaction_actor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_participants_last_reaction_message_conversation_idx"
    ON "conversation_participants" ("last_reaction_message_id", "conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_guidance_appointments_ended_by_idx"
    ON "project_guidance_appointments" ("ended_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_guidance_appointments_invitation_idx"
    ON "project_guidance_appointments" ("invitation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_invitations_resolved_by_idx"
    ON "project_invitations" ("resolved_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_invitations_role_idx"
    ON "project_invitations" ("role_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activity_events_sprint_idx"
    ON "task_activity_events" ("sprint_id");
