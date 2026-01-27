CREATE INDEX "connections_requester_idx" ON "connections" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "connections_addressee_idx" ON "connections" USING btree ("addressee_id");--> statement-breakpoint
CREATE INDEX "connections_status_requester_idx" ON "connections" USING btree ("status","requester_id");--> statement-breakpoint
CREATE INDEX "connections_status_addressee_idx" ON "connections" USING btree ("status","addressee_id");--> statement-breakpoint
CREATE INDEX "posts_author_idx" ON "posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "posts_project_idx" ON "posts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "posts_created_at_idx" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "posts_author_created_at_idx" ON "posts" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "profiles_username_idx" ON "profiles" USING btree ("username");--> statement-breakpoint
CREATE INDEX "profiles_email_idx" ON "profiles" USING btree ("email");--> statement-breakpoint
CREATE INDEX "project_members_project_idx" ON "project_members" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "projects_created_at_idx" ON "projects" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "projects_status_visibility_idx" ON "projects" USING btree ("status","visibility");--> statement-breakpoint
CREATE INDEX "projects_category_status_idx" ON "projects" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "projects_created_at_status_idx" ON "projects" USING btree ("created_at","status");