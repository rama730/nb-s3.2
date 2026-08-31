import { sql, type SQL } from "drizzle-orm";
import { TASK_FILE_ROLE_KEYWORDS } from "@/lib/projects/task-file-intelligence";

/** Bounded first-page prefetch and subsequent pages use exactly the same filters. */
export function taskFileEntriesSql(projectId: string, taskIds: string[], deliverables: boolean, after?: string, query = "", role?: string) {
  return sql`
    ${taskFileAssociationsSql(projectId)}, ranked AS (
      SELECT a.*, row_number() OVER (PARTITION BY a.task_id ORDER BY a.node_id) AS position
      FROM attachments a
      WHERE a.task_id IN (${sql.join(taskIds.map(id => sql`${id}::uuid`), sql`, `)})
        AND ${deliverables ? sql`a.role = 'deliverable'` : sql`a.role IN ('working', 'reference')`}
        ${role ? sql`AND a.role = ${role}` : sql``}
        ${query ? sql`AND EXISTS (SELECT 1 FROM project_nodes n WHERE n.id = a.node_id AND strpos(lower(n.name), lower(${query.slice(0, 200)})) > 0)` : sql``}
        ${after ? sql`AND a.node_id > ${after}::uuid` : sql``}
    ) SELECT * FROM ranked WHERE position <= 51 ORDER BY task_id, node_id
  `;
}

/** SQL equivalent of inferTaskFileRole, for filtering before pagination. */
export function taskFileRoleSql(input: { tags: SQL; annotation: SQL; name: SQL; canonicalNodeId: SQL }) {
  const { tags, annotation, name, canonicalNodeId } = input;
  const ann = sql`lower(coalesce(${annotation}, ''))`;
  const annTokens = sql`regexp_split_to_array(regexp_replace(${ann}, '[.][a-z0-9]+$', ''), '[^a-z0-9]+')`;
  const nameTokens = sql`regexp_split_to_array(regexp_replace(lower(trim(coalesce(${name}, ''))), '[.][^/.]+$', ''), '[^a-z0-9]+')`;
  const matches = (tokens: SQL, keywords: string[]) => sql`${tokens} && ARRAY[${sql.join(keywords.map(word => sql`${word}`), sql`, `)}]::text[]`;
  return sql`CASE
    WHEN ${tags} ? 'deliverable' THEN 'deliverable'
    WHEN ${tags} ? 'initial_reference' THEN 'reference'
    WHEN ${tags} ? 'working_file' THEN 'working'
    WHEN strpos(${ann}, '#deliverable') > 0 THEN 'deliverable'
    WHEN strpos(${ann}, '#initial_reference') > 0 THEN 'reference'
    WHEN strpos(${ann}, '#working_file') > 0 THEN 'working'
    WHEN ${annotation} = 'deliverable' THEN 'deliverable'
    WHEN ${annotation} = 'reference' THEN 'reference'
    WHEN ${matches(annTokens, TASK_FILE_ROLE_KEYWORDS.deliverable)} THEN 'deliverable'
    WHEN ${matches(annTokens, TASK_FILE_ROLE_KEYWORDS.reference)} THEN 'reference'
    WHEN ${matches(annTokens, TASK_FILE_ROLE_KEYWORDS.working)} THEN 'working'
    WHEN ${canonicalNodeId} IS NOT NULL THEN 'deliverable'
    WHEN ${matches(nameTokens, TASK_FILE_ROLE_KEYWORDS.deliverable)} THEN 'deliverable'
    WHEN ${matches(nameTokens, TASK_FILE_ROLE_KEYWORDS.reference)} THEN 'reference'
    ELSE 'working' END`;
}

/** Collection is a read model over links/legacy ownership, not another folder tree. */
export function taskFileAssociationsSql(projectId: string) {
  return sql`WITH attachments AS (
    SELECT l.task_id, n.id AS node_id,
      ${taskFileRoleSql({ tags: sql`l.tags`, annotation: sql`l.annotation`, name: sql`n.name`, canonicalNodeId: sql`n.canonical_node_id` })} AS role
    FROM task_node_links l
    JOIN project_nodes n ON n.id = l.node_id AND n.project_id = ${projectId} AND n.deleted_at IS NULL
    JOIN tasks t ON t.id = l.task_id AND t.project_id = ${projectId} AND t.deleted_at IS NULL
    UNION ALL
    SELECT t.id, n.id,
      ${taskFileRoleSql({ tags: sql`'[]'::jsonb`, annotation: sql`NULL::text`, name: sql`n.name`, canonicalNodeId: sql`n.canonical_node_id` })} AS role
    FROM tasks t
    JOIN project_nodes n ON n.project_id = t.project_id AND n.deleted_at IS NULL
      AND (n.task_id = t.id OR n.path LIKE '/.system/tasks/' || t.id::text || '/%')
    LEFT JOIN project_nodes parent ON parent.id = n.parent_id
    WHERE t.project_id = ${projectId} AND t.deleted_at IS NULL
      AND (n.metadata ->> 'taskFileDetachedFrom') IS DISTINCT FROM t.id::text
      AND n.path IS DISTINCT FROM '/.system/tasks/' || t.id::text
      AND (parent.id IS NULL OR parent.path = '/.system/tasks/' || t.id::text
        OR (parent.task_id IS NULL AND coalesce(parent.path, '') NOT LIKE '/.system/tasks/%'))
      AND NOT EXISTS (SELECT 1 FROM task_node_links l WHERE l.task_id = t.id AND l.node_id = n.id)
  )`;
}
