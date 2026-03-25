-- Phase 3: Database Scalability - Hash Partitioning for High-Growth Tables

-- 1. Partitioning TASKS Table by project_id
-- This allows O(1) partition pruning for project-specific queries.

DROP TABLE IF EXISTS tasks_p0, tasks_p1, tasks_p2, tasks_p3, tasks_p4, tasks_p5, tasks_p6, tasks_p7, tasks_p8, tasks_p9, tasks_p10, tasks_p11, tasks_p12, tasks_p13, tasks_p14, tasks_p15 CASCADE;
DROP TABLE IF EXISTS tasks_partitioned CASCADE;

-- Create the partitioned table template
CREATE TABLE tasks_partitioned (
    id UUID NOT NULL,
    project_id UUID NOT NULL,
    sprint_id UUID,
    assignee_id UUID,
    creator_id UUID,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo' NOT NULL,
    priority TEXT DEFAULT 'medium' NOT NULL,
    task_number INTEGER,
    story_points INTEGER,
    due_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (id, project_id) -- Partition key must be part of the primary key
) PARTITION BY HASH (project_id);

-- Create 16 partitions
CREATE TABLE tasks_p0 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE tasks_p1 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE tasks_p2 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE tasks_p3 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE tasks_p4 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE tasks_p5 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE tasks_p6 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE tasks_p7 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE tasks_p8 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE tasks_p9 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE tasks_p10 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE tasks_p11 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE tasks_p12 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE tasks_p13 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE tasks_p14 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE tasks_p15 PARTITION OF tasks_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 15);

-- Copy data
INSERT INTO tasks_partitioned (id, project_id, sprint_id, assignee_id, creator_id, title, description, status, priority, task_number, story_points, due_date, created_at, updated_at, deleted_at)
SELECT id, project_id, sprint_id, assignee_id, creator_id, title, description, status, priority, task_number, story_points, due_date, created_at, updated_at, deleted_at FROM tasks;

-- Swap tables (DANGEROUS: should be done with downtime or maintenance window)
-- ALTER TABLE tasks RENAME TO tasks_old;
-- ALTER TABLE tasks_partitioned RENAME TO tasks;

-- 2. Partitioning MESSAGES Table by conversation_id
-- Most message queries are conversation-scoped.

DROP TABLE IF EXISTS messages_p0, messages_p1, messages_p2, messages_p3, messages_p4, messages_p5, messages_p6, messages_p7, messages_p8, messages_p9, messages_p10, messages_p11, messages_p12, messages_p13, messages_p14, messages_p15 CASCADE;
DROP TABLE IF EXISTS messages_partitioned CASCADE;

CREATE TABLE messages_partitioned (
    id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    sender_id UUID,
    reply_to_message_id UUID,
    client_message_id TEXT,
    content TEXT,
    type TEXT DEFAULT 'text',
    metadata JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    edited_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (id, conversation_id)
) PARTITION BY HASH (conversation_id);

-- Create 16 partitions
CREATE TABLE messages_p0 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE messages_p1 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE messages_p2 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE messages_p3 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE messages_p4 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE messages_p5 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE messages_p6 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE messages_p7 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE messages_p8 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE messages_p9 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE messages_p10 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE messages_p11 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE messages_p12 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE messages_p13 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE messages_p14 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE messages_p15 PARTITION OF messages_partitioned FOR VALUES WITH (MODULUS 16, REMAINDER 15);

-- Copy data
INSERT INTO messages_partitioned (id, conversation_id, sender_id, reply_to_message_id, client_message_id, content, type, metadata, created_at, edited_at, deleted_at)
SELECT id, conversation_id, sender_id, reply_to_message_id, client_message_id, content, type, metadata, created_at, edited_at, deleted_at FROM messages;

-- Swap tables (DANGEROUS)
-- ALTER TABLE messages RENAME TO messages_old;
-- ALTER TABLE messages_partitioned RENAME TO messages;

-- Indices must be recreated on the partitioned table (Postgres 11+)
-- They will be automatically inherited by all existing and future partitions.
CREATE INDEX tasks_project_idx_p ON tasks_partitioned (project_id);
CREATE INDEX tasks_assignee_idx_p ON tasks_partitioned (assignee_id);
CREATE INDEX messages_conversation_created_idx_p ON messages_partitioned (conversation_id, created_at);
