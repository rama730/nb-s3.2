# Task Features Setup - Manual Steps

## ✅ Database Migration - COMPLETE

The database migration has been successfully run! The following were created:

- ✅ `task_subtasks` table
- ✅ `task_comments` table
- ✅ `task_comment_likes` table
- ✅ `task_files` table
- ✅ All indexes created
- ✅ Real-time enabled for all tables

⚠️ **Note:** Some RLS policies had errors and need to be fixed (see below).

---

## 🔧 Fix RLS Policies (Required)

The following RLS policies failed because they referenced `p.creator_id`
incorrectly. Run this SQL in your Supabase SQL Editor:

```sql
-- Fix task_subtasks policies
DROP POLICY IF EXISTS "Users can view subtasks of tasks they can access" ON task_subtasks;
DROP POLICY IF EXISTS "Members can create subtasks" ON task_subtasks;
DROP POLICY IF EXISTS "Members can update subtasks" ON task_subtasks;
DROP POLICY IF EXISTS "Members can delete subtasks" ON task_subtasks;

CREATE POLICY "Users can view subtasks of tasks they can access"
ON task_subtasks FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_subtasks.task_id
        AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
    )
);

CREATE POLICY "Members can create subtasks"
ON task_subtasks FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_subtasks.task_id
        AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
    )
);

CREATE POLICY "Members can update subtasks"
ON task_subtasks FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_subtasks.task_id
        AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
    )
);

CREATE POLICY "Members can delete subtasks"
ON task_subtasks FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_subtasks.task_id
        AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
    )
);

-- Fix task_comments policies
DROP POLICY IF EXISTS "Users can view comments of tasks they can access" ON task_comments;
DROP POLICY IF EXISTS "Members can create comments" ON task_comments;

CREATE POLICY "Users can view comments of tasks they can access"
ON task_comments FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_comments.task_id
        AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
    )
);

CREATE POLICY "Members can create comments"
ON task_comments FOR INSERT
WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_comments.task_id
        AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
    )
);

-- Fix task_comment_likes policies  
DROP POLICY IF EXISTS "Users can view comment likes" ON task_comment_likes;

CREATE POLICY "Users can view comment likes"
ON task_comment_likes FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM task_comments tc
        JOIN tasks t ON tc.task_id = t.id
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE tc.id = task_comment_likes.comment_id
        AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
    )
);

-- Fix task_files policies
DROP POLICY IF EXISTS "Users can view files of tasks they can access" ON task_files;
DROP POLICY IF EXISTS "Members can upload files" ON task_files;

CREATE POLICY "Users can view files of tasks they can access"
ON task_files FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_files.task_id
        AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
    )
);

CREATE POLICY "Members can upload files"
ON task_files FOR INSERT
WITH CHECK (
    uploaded_by = auth.uid() AND
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_files.task_id
        AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
    )
);
```

---

## 📦 Create Storage Bucket (Required)

### Option 1: Via Supabase Dashboard (Recommended)

1. Go to
   https://supabase.com/dashboard/project/iutauehhgdymtpzrnzcy/storage/buckets
2. Click **"New bucket"**
3. Settings:
   - **Name:** `task-files`
   - **Public:** false (Private)
   - **File size limit:** 10 MB (10485760 bytes)
   - **Allowed MIME types:** Leave empty (allow all)
4. Click **"Create bucket"**

### Option 2: Via SQL

Run this in your Supabase SQL Editor:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('task-files', 'task-files', false, 10485760)
ON CONFLICT (id) DO NOTHING;
```

---

## 🔒 Apply Storage RLS Policies (Required)

After creating the bucket, apply these policies via Supabase Dashboard > Storage
> task-files > Policies:

```sql
-- Allow project members to upload task files
CREATE POLICY "Project members can upload task files"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'task-files' AND
    auth.uid() IN (
        SELECT user_id FROM project_members WHERE project_id = (storage.foldername(name))[1]::uuid
        UNION
        SELECT created_by FROM projects WHERE id = (storage.foldername(name))[1]::uuid
    )
);

-- Allow project members to view task files
CREATE POLICY "Project members can view task files"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'task-files' AND
    auth.uid() IN (
        SELECT user_id FROM project_members WHERE project_id = (storage.foldername(name))[1]::uuid
        UNION
        SELECT created_by FROM projects WHERE id = (storage.foldername(name))[1]::uuid
    )
);

-- Allow file owners to delete their uploads
CREATE POLICY "Users can delete own task files"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'task-files' AND
    auth.uid() = owner
);

-- Allow file owners to update their uploads  
CREATE POLICY "Users can update own task files"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'task-files' AND
    auth.uid() = owner
);
```

---

## ✅ Verify Everything Works

Once all the above steps are complete:

1. Open your app: http://localhost:3000
2. Go to a project's Tasks tab
3. Click on any task to open the detail panel
4. Test each tab:
   - **Details:** Edit title, description, status, priority, assignee
   - **Subtasks:** Add, complete, delete subtasks
   - **Comments:** Post comments, like them
   - **Files:** Upload a file, download it, delete it

---

## 🆘 Troubleshooting

**"Error: relation does not exist"**

- Run the RLS policy fixes above

**"Storage operation failed"**

- Ensure the `task-files` bucket exists
- Verify storage RLS policies are applied

**"Permission denied"**

- Check that you're logged in as a project member
- Verify RLS policies are correct
