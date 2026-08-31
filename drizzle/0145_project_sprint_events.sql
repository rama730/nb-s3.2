CREATE TABLE IF NOT EXISTS "project_sprint_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "sprint_id" uuid NOT NULL REFERENCES "project_sprints"("id") ON DELETE CASCADE,
  "actor_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sprint_events_sprint_created_idx" ON "project_sprint_events" USING btree ("sprint_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sprint_events_project_created_idx" ON "project_sprint_events" USING btree ("project_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sprint_events_actor_idx" ON "project_sprint_events" USING btree ("actor_id");
