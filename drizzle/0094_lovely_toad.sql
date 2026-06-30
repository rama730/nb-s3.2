ALTER TABLE "project_update_comments" ADD COLUMN IF NOT EXISTS "target_user_id" uuid;--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'project_update_comments_target_user_id_profiles_id_fk' 
          AND table_name = 'project_update_comments'
    ) THEN
        ALTER TABLE "project_update_comments" 
        ADD CONSTRAINT "project_update_comments_target_user_id_profiles_id_fk" 
        FOREIGN KEY ("target_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;