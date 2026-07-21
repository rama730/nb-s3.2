CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_private.retired_domain_archive (
    source_table text NOT NULL,
    source_key text NOT NULL,
    payload jsonb NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_table, source_key)
);

INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
SELECT 'skill_relationships', id::text, to_jsonb(row_data)
FROM public.skill_relationships AS row_data
ON CONFLICT (source_table, source_key) DO NOTHING;

INSERT INTO app_private.retired_domain_archive (source_table, source_key, payload)
SELECT 'skill_catalog_releases', id::text, to_jsonb(row_data)
FROM public.skill_catalog_releases AS row_data
ON CONFLICT (source_table, source_key) DO NOTHING;

DROP TABLE IF EXISTS public.skill_relationships CASCADE;
DROP TABLE IF EXISTS public.skill_catalog_releases CASCADE;
