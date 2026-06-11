ALTER TYPE "public"."status_role_app" ADD VALUE 'withdrawn';
--> statement-breakpoint
ALTER TYPE "public"."status_role_app" ADD VALUE 'proposed';
--> statement-breakpoint
ALTER TABLE "public"."role_applications" ADD COLUMN "proposed_role_id" uuid REFERENCES "public"."project_open_roles"("id") ON DELETE SET NULL;
