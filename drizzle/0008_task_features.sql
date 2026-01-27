-- Task Subtasks Table
CREATE TABLE IF NOT EXISTS task_subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_task_subtasks_task_id ON task_subtasks(task_id);
CREATE INDEX idx_task_subtasks_position ON task_subtasks(task_id, position);

-- Task Comments Table
CREATE TABLE IF NOT EXISTS task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX idx_task_comments_created_at ON task_comments(task_id, created_at DESC);

-- Task Comment Likes Table
CREATE TABLE IF NOT EXISTS task_comment_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(comment_id, user_id)
);

CREATE INDEX idx_task_comment_likes_comment_id ON task_comment_likes(comment_id);
CREATE INDEX idx_task_comment_likes_user_id ON task_comment_likes(user_id);

-- Task Files Table
CREATE TABLE IF NOT EXISTS task_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_type TEXT,
    uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_task_files_task_id ON task_files(task_id);
CREATE INDEX idx_task_files_uploaded_by ON task_files(uploaded_by);

-- Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE task_subtasks;
ALTER PUBLICATION supabase_realtime ADD TABLE task_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE task_comment_likes;
ALTER PUBLICATION supabase_realtime ADD TABLE task_files;

-- RLS Policies

-- task_subtasks policies
ALTER TABLE task_subtasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view subtasks of tasks they can access"
ON task_subtasks FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_subtasks.task_id
        AND (p.creator_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.creator_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.creator_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.creator_id = auth.uid() OR pm.user_id = auth.uid())
    )
);

-- task_comments policies
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comments of tasks they can access"
ON task_comments FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_comments.task_id
        AND (p.creator_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.creator_id = auth.uid() OR pm.user_id = auth.uid())
    )
);

CREATE POLICY "Users can delete their own comments"
ON task_comments FOR DELETE
USING (user_id = auth.uid());

-- task_comment_likes policies
ALTER TABLE task_comment_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comment likes"
ON task_comment_likes FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM task_comments tc
        JOIN tasks t ON tc.task_id = t.id
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE tc.id = task_comment_likes.comment_id
        AND (p.creator_id = auth.uid() OR pm.user_id = auth.uid())
    )
);

CREATE POLICY "Users can create their own likes"
ON task_comment_likes FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own likes"
ON task_comment_likes FOR DELETE
USING (user_id = auth.uid());

-- task_files policies
ALTER TABLE task_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view files of tasks they can access"
ON task_files FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        WHERE t.id = task_files.task_id
        AND (p.creator_id = auth.uid() OR pm.user_id = auth.uid())
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
        AND (p.creator_id = auth.uid() OR pm.user_id = auth.uid())
    )
);

CREATE POLICY "Uploaders can delete their own files"
ON task_files FOR DELETE
USING (uploaded_by = auth.uid());
