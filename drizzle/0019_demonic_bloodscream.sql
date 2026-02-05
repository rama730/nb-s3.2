ALTER TABLE "projects" ADD COLUMN "import_source" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sync_status" text DEFAULT 'ready' NOT NULL;