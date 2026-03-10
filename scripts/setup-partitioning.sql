-- scripts/setup-partitioning.sql

-- 1. project_node_events
CREATE TABLE IF NOT EXISTS project_node_events (
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
CREATE TABLE IF NOT EXISTS project_node_events_2026_01 PARTITION OF project_node_events FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_02 PARTITION OF project_node_events FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_03 PARTITION OF project_node_events FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_04 PARTITION OF project_node_events FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_05 PARTITION OF project_node_events FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_06 PARTITION OF project_node_events FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_07 PARTITION OF project_node_events FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_08 PARTITION OF project_node_events FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_09 PARTITION OF project_node_events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_10 PARTITION OF project_node_events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_11 PARTITION OF project_node_events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS project_node_events_2026_12 PARTITION OF project_node_events FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
-- Default to catch anything else
CREATE TABLE IF NOT EXISTS project_node_events_default PARTITION OF project_node_events DEFAULT;

CREATE INDEX IF NOT EXISTS project_node_events_project_idx ON project_node_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS project_node_events_node_idx ON project_node_events(node_id, created_at);


-- 2. project_run_logs
CREATE TABLE IF NOT EXISTS project_run_logs (
    id UUID DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES project_run_sessions(id),
    project_id UUID NOT NULL REFERENCES projects(id),
    stream TEXT DEFAULT 'stdout' NOT NULL,
    line_number INTEGER DEFAULT 0 NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS project_run_logs_2026_01 PARTITION OF project_run_logs FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_02 PARTITION OF project_run_logs FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_03 PARTITION OF project_run_logs FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_04 PARTITION OF project_run_logs FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_05 PARTITION OF project_run_logs FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_06 PARTITION OF project_run_logs FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_07 PARTITION OF project_run_logs FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_08 PARTITION OF project_run_logs FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_09 PARTITION OF project_run_logs FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_10 PARTITION OF project_run_logs FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_11 PARTITION OF project_run_logs FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS project_run_logs_2026_12 PARTITION OF project_run_logs FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS project_run_logs_default PARTITION OF project_run_logs DEFAULT;

CREATE INDEX IF NOT EXISTS project_run_logs_session_idx ON project_run_logs(session_id, line_number);
CREATE INDEX IF NOT EXISTS project_run_logs_project_idx ON project_run_logs(project_id, created_at);


-- 3. project_run_diagnostics
CREATE TABLE IF NOT EXISTS project_run_diagnostics (
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

CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_01 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_02 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_03 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_04 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_05 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_06 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_07 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_08 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_09 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_10 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_11 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_2026_12 PARTITION OF project_run_diagnostics FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS project_run_diagnostics_default PARTITION OF project_run_diagnostics DEFAULT;

CREATE INDEX IF NOT EXISTS project_run_diagnostics_session_idx ON project_run_diagnostics(session_id, severity);
CREATE INDEX IF NOT EXISTS project_run_diagnostics_project_idx ON project_run_diagnostics(project_id, created_at);


-- 4. Automated Partition Management

-- Check if pg_cron is available
-- Requires server config: shared_preload_libraries = 'pg_cron' AND CREATE EXTENSION pg_cron
DO $$
DECLARE
    v_schema name;
BEGIN
    SELECT extnamespace::regnamespace INTO v_schema FROM pg_extension WHERE extname = 'pg_cron';
    IF NOT FOUND THEN
        RAISE WARNING 'pg_cron extension is not installed. Future partitions will not be created automatically.';
        RETURN;
    END IF;
END $$;

-- Create function to build next N months of partitions
CREATE OR REPLACE FUNCTION create_future_partitions()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_tables text[] := ARRAY['project_node_events', 'project_run_logs', 'project_run_diagnostics'];
    v_table text;
    v_default_table text;
    v_month_offset int;
    v_target_date date;
    v_part_name text;
    v_start_val text;
    v_end_val text;
    v_default_exists boolean;
    v_default_attached boolean;
    v_rows_moved bigint;
BEGIN
    -- Detach each default partition, build/create ranges, move matching rows, then reattach default.
    -- This avoids "partition constraint violated by some row in default partition" on future partition creation.
    FOREACH v_table IN ARRAY v_tables LOOP
        v_default_table := v_table || '_default';
        v_default_exists := false;
        v_default_attached := false;

        SELECT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = v_default_table
        ) INTO v_default_exists;

        IF v_default_exists THEN
            SELECT EXISTS (
                SELECT 1
                FROM pg_inherits i
                JOIN pg_class child ON child.oid = i.inhrelid
                JOIN pg_class parent ON parent.oid = i.inhparent
                JOIN pg_namespace n_child ON n_child.oid = child.relnamespace
                JOIN pg_namespace n_parent ON n_parent.oid = parent.relnamespace
                WHERE n_child.nspname = 'public'
                  AND n_parent.nspname = 'public'
                  AND child.relname = v_default_table
                  AND parent.relname = v_table
            ) INTO v_default_attached;
        END IF;

        IF v_default_attached THEN
            EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', v_table, v_default_table);
        END IF;

        BEGIN
            -- Look ahead 3 months and ensure partitions exist
            FOR v_month_offset IN 0..3 LOOP
                v_target_date := date_trunc('month', CURRENT_TIMESTAMP + (v_month_offset || ' month')::interval)::date;
                v_start_val := to_char(v_target_date, 'YYYY-MM-DD');
                v_end_val := to_char(v_target_date + interval '1 month', 'YYYY-MM-DD');
                v_part_name := v_table || '_' || to_char(v_target_date, 'YYYY_MM');

                -- Check if partition already exists
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = v_part_name
                ) THEN
                    BEGIN
                        EXECUTE format(
                            'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                            v_part_name, v_table, v_start_val, v_end_val
                        );
                        RAISE NOTICE 'Created partition % for %', v_part_name, v_table;
                    EXCEPTION WHEN duplicate_table THEN
                        -- Race condition gracefully handled
                        NULL;
                    END;
                END IF;

                -- Move rows for this range out of detached default into the parent table.
                -- They will route into the newly available monthly partition.
                IF v_default_exists THEN
                    EXECUTE format(
                        'WITH moved AS (
                            DELETE FROM %I
                            WHERE created_at >= %L::timestamptz
                              AND created_at < %L::timestamptz
                            RETURNING *
                        )
                        INSERT INTO %I
                        SELECT * FROM moved',
                        v_default_table,
                        v_start_val,
                        v_end_val,
                        v_table
                    );
                    GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
                    IF v_rows_moved > 0 THEN
                        RAISE NOTICE 'Moved % rows from % into % [% - %)',
                            v_rows_moved, v_default_table, v_table, v_start_val, v_end_val;
                    END IF;
                END IF;
            END LOOP;

            IF v_default_attached THEN
                EXECUTE format('ALTER TABLE %I ATTACH PARTITION %I DEFAULT', v_table, v_default_table);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Best effort re-attach to avoid leaving defaults detached on partial failures.
            IF v_default_attached THEN
                BEGIN
                    EXECUTE format('ALTER TABLE %I ATTACH PARTITION %I DEFAULT', v_table, v_default_table);
                EXCEPTION WHEN OTHERS THEN
                    RAISE WARNING 'Failed to re-attach default partition % to % after error',
                        v_default_table, v_table;
                END;
            END IF;
            RAISE;
        END;
    END LOOP;
END;
$$;

-- Run the function immediately to ensure we are covered right now.
SELECT create_future_partitions();

-- Schedule via pg_cron to run daily shortly after midnight so future partitions
-- are always created ahead of ingestion windows.
DO $$
DECLARE
    v_job_id bigint := NULL;
    v_job_schedule text := NULL;
    v_desired_schedule constant text := '5 0 * * *';
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF to_regclass('cron.job') IS NOT NULL THEN
            EXECUTE $sql$
                SELECT jobid, schedule
                FROM cron.job
                WHERE jobname = 'create_monthly_partitions'
                ORDER BY jobid DESC
                LIMIT 1
            $sql$ INTO v_job_id, v_job_schedule;
        END IF;

        IF v_job_id IS NULL THEN
            PERFORM cron.schedule('create_monthly_partitions', v_desired_schedule, 'SELECT create_future_partitions()');
        ELSIF v_job_schedule IS DISTINCT FROM v_desired_schedule THEN
            PERFORM cron.unschedule(v_job_id);
            PERFORM cron.schedule('create_monthly_partitions', v_desired_schedule, 'SELECT create_future_partitions()');
        END IF;
    END IF;
END $$;

-- 5. Data Integrity Checks (Synced from ORM schema)
ALTER TABLE "connections" DROP CONSTRAINT IF EXISTS "connections_no_self_check";
ALTER TABLE "connections" ADD CONSTRAINT "connections_no_self_check" CHECK ("requester_id" <> "addressee_id") NOT VALID;
ALTER TABLE "connections" VALIDATE CONSTRAINT "connections_no_self_check";

ALTER TABLE "project_nodes" DROP CONSTRAINT IF EXISTS "project_nodes_no_self_parent_check";
ALTER TABLE "project_nodes" ADD CONSTRAINT "project_nodes_no_self_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id") NOT VALID;
ALTER TABLE "project_nodes" VALIDATE CONSTRAINT "project_nodes_no_self_parent_check";

ALTER TABLE "project_open_roles" DROP CONSTRAINT IF EXISTS "project_open_roles_count_non_negative_check";
ALTER TABLE "project_open_roles" ADD CONSTRAINT "project_open_roles_count_non_negative_check" CHECK ("count" >= 0) NOT VALID;
ALTER TABLE "project_open_roles" VALIDATE CONSTRAINT "project_open_roles_count_non_negative_check";

ALTER TABLE "project_open_roles" DROP CONSTRAINT IF EXISTS "project_open_roles_filled_non_negative_check";
ALTER TABLE "project_open_roles" ADD CONSTRAINT "project_open_roles_filled_non_negative_check" CHECK ("filled" >= 0) NOT VALID;
ALTER TABLE "project_open_roles" VALIDATE CONSTRAINT "project_open_roles_filled_non_negative_check";

ALTER TABLE "project_open_roles" DROP CONSTRAINT IF EXISTS "project_open_roles_filled_lte_count_check";
ALTER TABLE "project_open_roles" ADD CONSTRAINT "project_open_roles_filled_lte_count_check" CHECK ("filled" <= "count") NOT VALID;
ALTER TABLE "project_open_roles" VALIDATE CONSTRAINT "project_open_roles_filled_lte_count_check";

-- 6. Added Profile Fields Synchronization
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "experience_level" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "hours_per_week" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "gender_identity" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "pronouns" text;
