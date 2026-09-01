import { db } from "@/lib/db";
import { profiles, type ProjectNode } from "@/lib/db/schema";
import { inArray, sql } from "drizzle-orm";

export type FileAttribution = {
  updatedById?: string | null;
  updatedByName?: string | null;
  updatedByUsername?: string | null;
  updatedByAvatarUrl?: string | null;
  versionUpdatedAt?: Date | string | null;
};

type LatestVersionAttributionRow = {
  node_id: string;
  uploaded_by: string | null;
  uploaded_at: Date | string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  external_name: string | null;
};

const BATCH_SIZE = 1_000;

/** Canonical updater projection shared by Files and task attachments. */
export async function getFileAttributionByNodeId(
  nodes: readonly ProjectNode[],
): Promise<Map<string, FileAttribution>> {
  const files = nodes.filter((node) => node.type === "file");
  const latestByNodeId = new Map<string, LatestVersionAttributionRow>();

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const chunk = files.slice(i, i + BATCH_SIZE).map((node) => node.id);
    const rows = await db.execute<LatestVersionAttributionRow>(sql`
      SELECT
        fv.node_id,
        fv.uploaded_by,
        fv.uploaded_at,
        p.full_name,
        p.username,
        p.avatar_url,
        CASE WHEN fv.attribution->>'source' = 'github' THEN fv.attribution->'contributors'->0->>'name' END AS external_name
      FROM file_versions fv
      INNER JOIN project_nodes pn
        ON pn.id = fv.node_id
       AND pn.current_version = fv.version
      LEFT JOIN profiles p ON p.id = fv.uploaded_by
      WHERE fv.node_id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
    `);
    for (const row of Array.from(rows)) latestByNodeId.set(row.node_id, row);
  }

  const creatorIds = Array.from(new Set(files.flatMap((node) =>
    node.createdBy && !latestByNodeId.has(node.id) ? [node.createdBy] : [],
  )));
  const creatorById = new Map<string, {
    fullName: string | null;
    username: string | null;
    avatarUrl: string | null;
  }>();
  if (creatorIds.length > 0) {
    const creators = await db.query.profiles.findMany({
      where: inArray(profiles.id, creatorIds),
      columns: {
        id: true,
        fullName: true,
        username: true,
        avatarUrl: true,
      },
    });
    for (const creator of creators) creatorById.set(creator.id, creator);
  }

  return new Map(files.flatMap((node) => {
    const latest = latestByNodeId.get(node.id);
    if (latest) {
      return [[node.id, {
        updatedById: latest.uploaded_by,
        updatedByName: latest.full_name || (latest.external_name ? `${latest.external_name} (GitHub)` : null),
        updatedByUsername: latest.username,
        updatedByAvatarUrl: latest.avatar_url,
        versionUpdatedAt: latest.uploaded_at ?? node.updatedAt,
      } satisfies FileAttribution] as const];
    }
    const creator = node.createdBy ? creatorById.get(node.createdBy) : null;
    return creator
      ? [[node.id, {
          updatedById: node.createdBy,
          updatedByName: creator.fullName,
          updatedByUsername: creator.username,
          updatedByAvatarUrl: creator.avatarUrl,
          versionUpdatedAt: node.updatedAt,
        } satisfies FileAttribution] as const]
      : [];
  }));
}
