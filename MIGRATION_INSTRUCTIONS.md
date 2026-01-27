# Database Migration Instructions

## Run the Files Enhancement Migration

Since automated migration failed, please run this SQL manually in your
**Supabase SQL Editor**:

### Step 1: Navigate to Supabase SQL Editor

Go to: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new

### Step 2: Copy and Execute This SQL

```sql
-- Files Tab Enhancement Migration
-- Adds support for custom naming, categories, descriptions, and better organization

-- 1. Add new columns to task_files table
ALTER TABLE task_files 
ADD COLUMN IF NOT EXISTS custom_name TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general',
ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- 2. Create indexes for performance (critical for fast queries)
CREATE INDEX IF NOT EXISTS idx_task_files_category ON task_files(category);
CREATE INDEX IF NOT EXISTS idx_task_files_created_at_desc ON task_files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_files_task_order ON task_files(task_id, created_at DESC);

-- 3. Create GIN index for JSONB tags (fast tag searches)
CREATE INDEX IF NOT EXISTS idx_task_files_tags ON task_files USING GIN(tags);

-- 4. Update existing records to have custom_name = file_name if null
UPDATE task_files 
SET custom_name = file_name 
WHERE custom_name IS NULL;

-- 5. Add comments for documentation
COMMENT ON COLUMN task_files.custom_name IS 'User-provided display name (e.g., "Bug Report Screenshot")';
COMMENT ON COLUMN task_files.description IS 'Optional file description';
COMMENT ON COLUMN task_files.category IS 'File category: general, design, code, docs, media, bug-report, feature';
COMMENT ON COLUMN task_files.tags IS 'Array of tags for flexible categorization';
COMMENT ON COLUMN task_files.display_order IS 'Manual ordering within task (0 = chronological)';
```

### Step 3: Verify Migration

After running the SQL, verify it worked:

```sql
-- Check if columns were added
SELECT 
    column_name, 
    data_type, 
    column_default 
FROM information_schema.columns 
WHERE table_name = 'task_files' 
AND column_name IN ('custom_name', 'description', 'category', 'tags', 'display_order');

-- Check if indexes were created
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'task_files' 
AND indexname LIKE 'idx_task_files_%';
```

You should see:

- 5 new columns
- 4 new indexes

### Step 4: Test the Files Tab

1. Go to any project in your application
2. Click on the "Files" tab
3. Try uploading a file with custom naming
4. Verify the task-grouped view displays correctly
