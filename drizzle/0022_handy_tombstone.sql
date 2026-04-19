CREATE TABLE "task_comment_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"content" text NOT NULL,
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_node_links" ADD COLUMN "order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task_node_links" ADD COLUMN "annotation" text;--> statement-breakpoint
ALTER TABLE "task_comment_likes" ADD CONSTRAINT "task_comment_likes_comment_id_task_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."task_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comment_likes" ADD CONSTRAINT "task_comment_likes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_parent_comment_id_task_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."task_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_deleted_by_profiles_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_task_comment_likes_comment_id" ON "task_comment_likes" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "idx_task_comment_likes_user_id" ON "task_comment_likes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_comment_likes_unique" ON "task_comment_likes" USING btree ("comment_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_task_comments_task_id" ON "task_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_task_comments_created_at" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_task_comments_parent_id" ON "task_comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "idx_task_comments_parent_created_at" ON "task_comments" USING btree ("task_id","parent_comment_id","created_at");
