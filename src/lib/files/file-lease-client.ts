"use client";

import { isLooseUuid } from "@/lib/validations/uuid";

export type FileLeaseClientKind = "web" | "vscode";

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

export interface BrowserFileLease extends FileLeaseView {
  leaseId: string;
  sessionId: string;
  fencingToken: number;
}

export class BrowserFileLeaseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly lock: FileLeaseView | null = null,
  ) {
    super(message);
    this.name = "BrowserFileLeaseError";
  }
}

const SESSION_KEY = "nb:file-lease-session:v1";

export function getBrowserFileLeaseSessionId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing && isLooseUuid(existing)) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as {
    success?: boolean;
    data?: T;
    message?: string;
    details?: { lock?: FileLeaseView };
  } | null;
  if (!response.ok || !payload?.success || payload.data === undefined) {
    throw new BrowserFileLeaseError(
      payload?.message || `File lease request failed (${response.status})`,
      response.status,
      payload?.details?.lock ?? null,
    );
  }
  return payload.data;
}

export async function acquireBrowserFileLease(projectId: string, nodeId: string) {
  const sessionId = getBrowserFileLeaseSessionId();
  const response = await fetch(`/api/v1/files/${encodeURIComponent(nodeId)}/lock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, sessionId, ttlSeconds: 120 }),
  });
  return readEnvelope<BrowserFileLease>(response);
}

export async function renewBrowserFileLease(lease: BrowserFileLease) {
  const response = await fetch(`/api/v1/files/${encodeURIComponent(lease.nodeId)}/lock-renew`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: lease.projectId,
      sessionId: lease.sessionId,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      ttlSeconds: 120,
    }),
  });
  return readEnvelope<BrowserFileLease>(response);
}

export async function releaseBrowserFileLease(
  lease: BrowserFileLease,
  options: { keepalive?: boolean } = {},
) {
  const response = await fetch(`/api/v1/files/${encodeURIComponent(lease.nodeId)}/lock`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: lease.projectId,
      sessionId: lease.sessionId,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
    }),
    keepalive: options.keepalive,
  });
  return readEnvelope<{ released: boolean }>(response);
}

export async function fetchProjectFileLeases(projectId: string) {
  const response = await fetch(`/api/v1/files/locks?projectId=${encodeURIComponent(projectId)}`, {
    cache: "no-store",
  });
  const result = await readEnvelope<{ locks: FileLeaseView[] }>(response);
  return result.locks;
}
