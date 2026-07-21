# Project file editing leases

Status: Accepted (2026-07-02)

## Decision

The Files tab and NB VS Code extension use one exclusive, database-backed
lease for file editing. A lease belongs to a user **and a concrete client
session**. The same account in a second tab or editor is therefore treated as
a separate writer.

Each lease contains an opaque `lease_id` and monotonically increasing
`fencing_token`. Revision writes validate both values while holding the file
row and lease row in the same database transaction. An expired or replaced
client cannot write even if its network request arrives late.

## Lifecycle

1. A client creates one random session UUID per browser tab or extension-host
   activation.
2. Edit mode opens only after an atomic lease acquisition succeeds.
3. The lease lasts 120 seconds and is renewed every 32-38 seconds with jitter.
4. Realtime events update project lock badges; a snapshot is fetched on mount,
   reconnect, and focus to repair missed events.
5. Clean close, navigation, sign-out, and extension deactivation release the
   lease. TTL expiry and the five-minute cleanup job recover from crashes.
6. Revision writes require `lease_id`, session UUID, fencing token,
   `baseVersion`, and (when available) `baseHash`.

## Conflict behavior

- HTTP `423 FILE_LOCKED` includes only safe holder information: display name,
  client kind, and acquisition/expiry timestamps. Lease and session secrets
  are never exposed to another client.
- Browser edit mode does not open on conflict.
- Extension files are marked read-only on conflict and publish is blocked.
- If a lease is lost while text is dirty, the browser editor becomes read-only
  without discarding its in-memory buffer. The extension's staged and recovery
  layers continue to preserve local content.
- Git pull is deferred while any project file has an active editor lease.
  Restore/delete operations use a short transient lease.

## Security and data access

Authenticated project members may select project leases through RLS. Direct
client insert/update/delete privileges are revoked; all mutations go through
server endpoints that derive `locked_by` from authenticated identity. Extension
leases are linked to their device session when applicable.

## Rollout and rollback

Migration `0101_project_file_leases.sql` adds the lease identity, fencing,
indexes, RLS hardening, and Supabase Realtime publication. Application and
extension `1.0.40` must be deployed together. If a rollback is required,
disable the new clients first; do not drop lease columns or fencing history.
Expired rows are safe to delete.

## Operational checks

- Active leases: `expires_at > now()`; long-lived rows without advancing
  `renewed_at` indicate a heartbeat problem.
- Conflict spikes are emitted as `files.lock.conflict_count`.
- Acquisition latency is emitted as `files.lock.acquire_ms`.
- `lock-cleanup` runs every five minutes in the worker role and deletes in
  bounded, skip-locked batches.
