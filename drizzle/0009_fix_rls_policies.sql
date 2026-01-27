-- Fix RLS policies for task features (CORRECTED VERSION)
-- The projects table uses 'owner_id', not 'created_by' or 'creator_id'

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
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.owner_id = auth.uid() OR pm.user_id = auth.uid())
    )
);
