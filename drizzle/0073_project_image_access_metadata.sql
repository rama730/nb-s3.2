ALTER TABLE "projects"
    ADD COLUMN IF NOT EXISTS "cover_image_bucket" text,
    ADD COLUMN IF NOT EXISTS "cover_image_key" text;
