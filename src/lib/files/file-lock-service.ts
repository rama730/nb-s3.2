import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, projectNodeLocks, projectNodes } from "@/lib/db/schema";
import { recordNodeEvent } from "@/lib/files/internal-helpers";
import { recordFilesMetric } from "@/lib/files/observability";

export const FILE_LEASE_TTL_SECONDS = 120;
export const FILE_LEASE_HEARTBEAT_MS = 35_000;

export type FileLeaseClientKind = "web" | "vscode";

export interface FileLeaseCredentials {
  leaseId: string;
  sessionId: string;
  fencingToken: number;
}

export interface FileLeaseView {
  nodeId: string;
  projectId: string;
  lockedBy: string;
  lockedByName: string | null;
  clientKind: FileLeaseClientKind;
  acquiredAt: number;
  renewedAt: number;
  expiresAt: number;
}

export interface OwnedFileLease extends FileLeaseView, FileLeaseCredentials {}

export interface AcquireFileLeaseInput {
  projectId: string;
  nodeId: string;
  userId: string;
  sessionId: string;
  clientKind: FileLeaseClientKind;
  deviceSessionId?: string | null;
  ttlSeconds?: number;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type LeaseRow = {
  nodeId: string;
  projectId: string;
  lockedBy: string;
  sessionId: string;
  leaseId: string;
  clientKind: FileLeaseClientKind;
  fencingToken: number | string;
  acquiredAt: Date | string;
  renewedAt: Date | string;
  expiresAt: Date | string;
};

function clampTtlSeconds(value: number | undefined) {
  return Math.max(30, Math.min(180, value ?? FILE_LEASE_TTL_SECONDS));
}

function toEpoch(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function toOwnedLease(row: LeaseRow, lockedByName: string | null = null): OwnedFileLease {
  return {
    nodeId: row.nodeId,
    projectId: row.projectId,
    lockedBy: row.lockedBy,
    lockedByName,
    clientKind: row.clientKind,
    leaseId: row.leaseId,
    sessionId: row.sessionId,
    fencingToken: Number(row.fencingToken),
    acquiredAt: toEpoch(row.acquiredAt),
    renewedAt: toEpoch(row.renewedAt),
    expiresAt: toEpoch(row.expiresAt),
  };
}

export class FileLeaseConflictError extends Error {
  readonly code = "FILE_LOCKED";

  constructor(readonly lock: FileLeaseView) {
    super(`File is being edited by ${lock.lockedByName || "another collaborator"}`);
    this.name = "FileLeaseConflictError";
  }
}

export class FileLeaseLostError extends Error {
  readonly code = "FILE_LEASE_LOST";

  constructor(message = "Your editing lease expired or was replaced. Reopen edit mode before saving.") {
    super(message);
    this.name = "FileLeaseLostError";
  }
}

async function readConflictLease(
  tx: DbTransaction,
  projectId: string,
  nodeId: string,
): Promise<FileLeaseView | null> {
  const [row] = await tx
    .select({
      nodeId: projectNodeLocks.nodeId,
      projectId: projectNodeLocks.projectId,
      lockedBy: projectNodeLocks.lockedBy,
      clientKind: projectNodeLocks.clientKind,
      acquiredAt: projectNodeLocks.acquiredAt,
      renewedAt: projectNodeLocks.renewedAt,
      expiresAt: projectNodeLocks.expiresAt,
      fullName: profiles.fullName,
      username: profiles.username,
    })
    .from(projectNodeLocks)
    .leftJoin(profiles, eq(profiles.id, projectNodeLocks.lockedBy))
    .where(
      and(
        eq(projectNodeLocks.projectId, projectId),
        eq(projectNodeLocks.nodeId, nodeId),
        gt(projectNodeLocks.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    nodeId: row.nodeId,
    projectId: row.projectId,
    lockedBy: row.lockedBy,
    lockedByName: row.fullName || row.username || null,
    clientKind: row.clientKind,
    acquiredAt: row.acquiredAt.getTime(),
    renewedAt: row.renewedAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
  };
}

/**
 * Atomically acquires or renews the exclusive lease for one file.
 * A same-user request from a different browser/editor session is a conflict.
 * Expired leases may be replaced; replacement receives a new fencing token.
 */
export async function acquireFileLease(input: AcquireFileLeaseInput): Promise<OwnedFileLease> {
  const startedAt = Date.now();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + clampTtlSeconds(input.ttlSeconds) * 1000);
  const candidateLeaseId = crypto.randomUUID();

  try {
    const lease = await db.transaction(async (tx) => {
      const node = await tx.query.projectNodes.findFirst({
        where: and(
          eq(projectNodes.id, input.nodeId),
          eq(projectNodes.projectId, input.projectId),
          eq(projectNodes.type, "file"),
        ),
        columns: { id: true, deletedAt: true },
      });
      if (!node || node.deletedAt) throw new Error("File not found");

      const result = await tx.execute<LeaseRow>(sql`
        INSERT INTO project_node_locks (
          node_id, project_id, locked_by, session_id, lease_id, client_kind,
          device_session_id, fencing_token, acquired_at, renewed_at, expires_at
        ) VALUES (
          ${input.nodeId}::uuid,
          ${input.projectId}::uuid,
          ${input.userId}::uuid,
          ${input.sessionId}::uuid,
          ${candidateLeaseId}::uuid,
          ${input.clientKind},
          ${input.deviceSessionId ?? null}::uuid,
          nextval('project_node_lock_fencing_seq'),
          ${now.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz,
          ${expiresAt.toISOString()}::timestamptz
        )
        ON CONFLICT (node_id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          locked_by = EXCLUDED.locked_by,
          session_id = EXCLUDED.session_id,
          lease_id = CASE
            WHEN project_node_locks.locked_by = EXCLUDED.locked_by
              AND project_node_locks.session_id = EXCLUDED.session_id
              AND project_node_locks.expires_at > ${now.toISOString()}::timestamptz
            THEN project_node_locks.lease_id
            ELSE EXCLUDED.lease_id
          END,
          client_kind = EXCLUDED.client_kind,
          device_session_id = EXCLUDED.device_session_id,
          fencing_token = CASE
            WHEN project_node_locks.locked_by = EXCLUDED.locked_by
              AND project_node_locks.session_id = EXCLUDED.session_id
              AND project_node_locks.expires_at > ${now.toISOString()}::timestamptz
            THEN project_node_locks.fencing_token
            ELSE nextval('project_node_lock_fencing_seq')
          END,
          acquired_at = CASE
            WHEN project_node_locks.locked_by = EXCLUDED.locked_by
              AND project_node_locks.session_id = EXCLUDED.session_id
              AND project_node_locks.expires_at > ${now.toISOString()}::timestamptz
            THEN project_node_locks.acquired_at
            ELSE EXCLUDED.acquired_at
          END,
          renewed_at = EXCLUDED.renewed_at,
          expires_at = EXCLUDED.expires_at
        WHERE project_node_locks.project_id = EXCLUDED.project_id
          AND (
            (
              project_node_locks.locked_by = EXCLUDED.locked_by
              AND project_node_locks.session_id = EXCLUDED.session_id
            )
            OR project_node_locks.expires_at <= ${now.toISOString()}::timestamptz
          )
        RETURNING
          node_id AS "nodeId",
          project_id AS "projectId",
          locked_by AS "lockedBy",
          session_id AS "sessionId",
          lease_id AS "leaseId",
          client_kind AS "clientKind",
          fencing_token AS "fencingToken",
          acquired_at AS "acquiredAt",
          renewed_at AS "renewedAt",
          expires_at AS "expiresAt"
      `);

      const row = Array.from(result)[0];
      if (!row) {
        const conflict = await readConflictLease(tx, input.projectId, input.nodeId);
        if (conflict) throw new FileLeaseConflictError(conflict);
        throw new FileLeaseLostError("The file lease changed while it was being acquired.");
      }

      const isNewLease = row.leaseId === candidateLeaseId;
      if (isNewLease) {
        await recordNodeEvent(
          input.projectId,
          input.userId,
          input.nodeId,
          "lock_acquire",
          {
            clientKind: input.clientKind,
            leaseId: row.leaseId,
            fencingToken: Number(row.fencingToken),
            expiresAt: expiresAt.toISOString(),
          },
          tx,
        );
      }

      return toOwnedLease(row);
    });

    recordFilesMetric("files.lock.acquire_ms", {
      projectId: input.projectId,
      nodeId: input.nodeId,
      value: Date.now() - startedAt,
      extra: { clientKind: input.clientKind },
    });
    return lease;
  } catch (error) {
    if (error instanceof FileLeaseConflictError) {
      recordFilesMetric("files.lock.conflict_count", {
        projectId: input.projectId,
        nodeId: input.nodeId,
        value: 1,
        extra: { clientKind: input.clientKind, holderClientKind: error.lock.clientKind },
      });
    }
    throw error;
  }
}

export async function renewFileLease(input: {
  projectId: string;
  nodeId: string;
  userId: string;
  credentials: FileLeaseCredentials;
  ttlSeconds?: number;
}): Promise<OwnedFileLease> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + clampTtlSeconds(input.ttlSeconds) * 1000);
  const result = await db.execute<LeaseRow>(sql`
    UPDATE project_node_locks
    SET renewed_at = ${now.toISOString()}::timestamptz,
        expires_at = ${expiresAt.toISOString()}::timestamptz
    WHERE node_id = ${input.nodeId}::uuid
      AND project_id = ${input.projectId}::uuid
      AND locked_by = ${input.userId}::uuid
      AND session_id = ${input.credentials.sessionId}::uuid
      AND lease_id = ${input.credentials.leaseId}::uuid
      AND fencing_token = ${input.credentials.fencingToken}
      AND expires_at > ${now.toISOString()}::timestamptz
    RETURNING
      node_id AS "nodeId", project_id AS "projectId", locked_by AS "lockedBy",
      session_id AS "sessionId", lease_id AS "leaseId", client_kind AS "clientKind",
      fencing_token AS "fencingToken", acquired_at AS "acquiredAt",
      renewed_at AS "renewedAt", expires_at AS "expiresAt"
  `);
  const row = Array.from(result)[0];
  if (!row) throw new FileLeaseLostError();
  return toOwnedLease(row);
}

export async function releaseFileLease(input: {
  projectId: string;
  nodeId: string;
  userId: string;
  credentials: FileLeaseCredentials;
}): Promise<boolean> {
  const result = await db.execute<{ nodeId: string }>(sql`
    DELETE FROM project_node_locks
    WHERE node_id = ${input.nodeId}::uuid
      AND project_id = ${input.projectId}::uuid
      AND locked_by = ${input.userId}::uuid
      AND session_id = ${input.credentials.sessionId}::uuid
      AND lease_id = ${input.credentials.leaseId}::uuid
      AND fencing_token = ${input.credentials.fencingToken}
    RETURNING node_id AS "nodeId"
  `);
  const released = Array.from(result).length > 0;
  if (released) {
    await recordNodeEvent(input.projectId, input.userId, input.nodeId, "lock_release", {
      leaseId: input.credentials.leaseId,
      fencingToken: input.credentials.fencingToken,
    });
  }
  return released;
}

export async function getProjectFileLeases(projectId: string): Promise<FileLeaseView[]> {
  const rows = await db
    .select({
      nodeId: projectNodeLocks.nodeId,
      projectId: projectNodeLocks.projectId,
      lockedBy: projectNodeLocks.lockedBy,
      clientKind: projectNodeLocks.clientKind,
      acquiredAt: projectNodeLocks.acquiredAt,
      renewedAt: projectNodeLocks.renewedAt,
      expiresAt: projectNodeLocks.expiresAt,
      fullName: profiles.fullName,
      username: profiles.username,
    })
    .from(projectNodeLocks)
    .leftJoin(profiles, eq(profiles.id, projectNodeLocks.lockedBy))
    .where(and(eq(projectNodeLocks.projectId, projectId), gt(projectNodeLocks.expiresAt, new Date())));

  return rows.map((row) => ({
    nodeId: row.nodeId,
    projectId: row.projectId,
    lockedBy: row.lockedBy,
    lockedByName: row.fullName || row.username || null,
    clientKind: row.clientKind,
    acquiredAt: row.acquiredAt.getTime(),
    renewedAt: row.renewedAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
  }));
}

/** Locks and validates the lease row inside the same transaction as the write. */
export async function assertOwnedFileLease(
  tx: DbTransaction,
  input: {
    projectId: string;
    nodeId: string;
    userId: string;
    credentials: FileLeaseCredentials;
  },
) {
  const result = await tx.execute<{ leaseId: string }>(sql`
    SELECT lease_id AS "leaseId"
    FROM project_node_locks
    WHERE node_id = ${input.nodeId}::uuid
      AND project_id = ${input.projectId}::uuid
      AND locked_by = ${input.userId}::uuid
      AND session_id = ${input.credentials.sessionId}::uuid
      AND lease_id = ${input.credentials.leaseId}::uuid
      AND fencing_token = ${input.credentials.fencingToken}
      AND expires_at > now()
    FOR UPDATE
  `);
  if (!Array.from(result)[0]) throw new FileLeaseLostError();
}

export async function deleteExpiredFileLeases(limit = 1_000) {
  const safeLimit = Math.max(1, Math.min(10_000, Math.trunc(limit)));
  const result = await db.execute<{ nodeId: string }>(sql`
    WITH expired AS (
      SELECT node_id
      FROM project_node_locks
      WHERE expires_at <= now()
      ORDER BY expires_at ASC
      LIMIT ${safeLimit}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM project_node_locks locks
    USING expired
    WHERE locks.node_id = expired.node_id
    RETURNING locks.node_id AS "nodeId"
  `);
  return Array.from(result).length;
}

/** Short lease for restore/delete/conflict-resolution actions without a long-lived editor. */
export async function withTransientFileLease<T>(
  input: { projectId: string; nodeId: string; userId: string },
  callback: (credentials: FileLeaseCredentials) => Promise<T>,
) {
  const lease = await acquireFileLease({
    ...input,
    sessionId: crypto.randomUUID(),
    clientKind: "web",
    ttlSeconds: 60,
  });
  try {
    return await callback({
      leaseId: lease.leaseId,
      sessionId: lease.sessionId,
      fencingToken: lease.fencingToken,
    });
  } finally {
    await releaseFileLease({
      ...input,
      credentials: lease,
    }).catch(() => false);
  }
}
