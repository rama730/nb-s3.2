-- scripts/setup-partitioning.sql

-- 1. project_node_events
DROP TABLE IF EXISTS project_node_events CASCADE;
CREATE TABLE project_node_events (
    id UUID DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    node_id UUID REFERENCES project_nodes(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create current partitions
CREATE TABLE project_node_events_2026_01 PARTITION OF project_node_events FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE project_node_events_2026_02 PARTITION OF project_node_events FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE project_node_events_2026_03 PARTITION OF project_node_events FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE project_node_events_2026_04 PARTITION OF project_node_events FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE project_node_events_2026_05 PARTITION OF project_node_events FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE project_node_events_2026_06 PARTITION OF project_node_events FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE project_node_events_2026_07 PARTITION OF project_node_events FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE project_node_events_2026_08 PARTITION OF project_node_events FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE project_node_events_2026_09 PARTITION OF project_node_events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE project_node_events_2026_10 PARTITION OF project_node_events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE project_node_events_2026_11 PARTITION OF project_node_events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE project_node_events_2026_12 PARTITION OF project_node_events FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
-- Default to catch anything else
CREATE TABLE project_node_events_default PARTITION OF project_node_events DEFAULT;

CREATE INDEX project_node_events_project_idx ON project_node_events(project_id, created_at);
CREATE INDEX project_node_events_node_idx ON project_node_events(node_id, created_at);


-- 2. project_run_logs
DROP TABLE IF EXISTS project_run_logs CASCADE;
CREATE TABLE project_run_logs (
    id UUID DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES project_run_sessions(id),
    project_id UUID NOT NULL REFERENCES projects(id),
    stream TEXT DEFAULT 'stdout' NOT NULL,
    line_number INTEGER DEFAULT 0 NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE project_run_logs_2026_01 PARTITION OF project_run_logs FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE project_run_logs_2026_02 PARTITION OF project_run_logs FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE project_run_logs_2026_03 PARTITION OF project_run_logs FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE project_run_logs_2026_04 PARTITION OF project_run_logs FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE project_run_logs_2026_05 PARTITION OF project_run_logs FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE project_run_logs_2026_06 PARTITION OF project_run_logs FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE project_run_logs_2026_07 PARTITION OF project_run_logs FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE project_run_logs_2026_08 PARTITION OF project_run_logs FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE project_run_logs_2026_09 PARTITION OF project_run_logs FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE project_run_logs_2026_10 PARTITION OF project_run_logs FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE project_run_logs_2026_11 PARTITION OF project_run_logs FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE project_run_logs_2026_12 PARTITION OF project_run_logs FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE project_run_logs_default PARTITION OF project_run_logs DEFAULT;

CREATE INDEX project_run_logs_session_idx ON project_run_logs(session_id, line_number);
CREATE INDEX project_run_logs_project_idx ON project_run_logs(project_id, created_at);


-- 3. project_run_diagnostics
DROP TABLE IF EXISTS project_run_diagnostics CASCADE;
CREATE TABLE project_run_diagnostics (
    id UUID DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES project_run_sessions(id),
    project_id UUID NOT NULL REFERENCES projects(id),
    node_id UUID REFERENCES project_nodes(id) ON DELETE SET NULL,
    file_path TEXT,
    line INTEGER,
    "column" INTEGER,
    severity TEXT DEFAULT 'error' NOT NULL,
    source TEXT,
    code TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE project_run_diagnostics_2026_01 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE project_run_diagnostics_2026_02 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE project_run_diagnostics_2026_03 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE project_run_diagnostics_2026_04 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE project_run_diagnostics_2026_05 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE project_run_diagnostics_2026_06 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE project_run_diagnostics_2026_07 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE project_run_diagnostics_2026_08 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE project_run_diagnostics_2026_09 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE project_run_diagnostics_2026_10 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE project_run_diagnostics_2026_11 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE project_run_diagnostics_2026_12 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE project_run_diagnostics_default PARTITION OF project_run_diagnostics DEFAULT;

CREATE INDEX project_run_diagnostics_session_idx ON project_run_diagnostics(session_id, severity);
CREATE INDEX project_run_diagnostics_project_idx ON project_run_diagnostics(project_id, created_at);
