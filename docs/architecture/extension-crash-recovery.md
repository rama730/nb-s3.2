# Extension Crash Recovery

The editor recovery system deliberately separates safety copies from published file history.

## Layer 1: local automatic recovery

- Every dirty `nb:` text document is snapshotted after 350 ms of idle time, with a hard maximum gap of one second during continuous typing.
- Bytes are written to the extension global-storage directory, verified with SHA-256, then atomically renamed into the current generation.
- The preceding verified generation is retained as a fallback if the newest file is corrupt or an interrupted filesystem write is observed.
- A local session marker and server-side recovery-session heartbeat distinguish active, clean, interrupted, and stale sessions. Current and clean-session snapshots remain silent; only interrupted non-current sessions become user-facing recovery incidents.
- A power loss can still lose the fraction of a second that has not reached the operating system or durable storage. The one-second maximum snapshot interval bounds that window; no application can guarantee bytes the OS never flushed.

## Layer 2: private account drafts

- The newest local generation uploads after two seconds of idle time and at least every ten seconds while editing continues.
- The API creates a signed upload URL for the private `extension-recovery-drafts` bucket. Finalization downloads the object server-side and verifies declared size and SHA-256 before marking it usable.
- Metadata records the owner, project, node, device, editor session, path, original version/hash, task provenance, capture time, and expiry.
- Only the owner can query/delete rows, and every API request re-checks project access. The bucket has no public read policy; downloads use short-lived signed URLs.
- The newest three finalized generations per device and file are retained for up to 30 days. Clean-session copies age out after 24 hours; incident copies retain the longer recovery window. A nightly retention job and account hard-delete cleanup remove both database rows and storage objects.
- Offline failures never block typing or local snapshots. Cloud uploads retry with bounded exponential backoff after connectivity returns.

## Session lifecycle and incident detection

- Each extension activation creates a unique recovery session and heartbeats it while authenticated.
- Clean deactivation flushes local snapshots, marks the local marker clean, and best-effort closes the server session.
- On startup, an active previous local marker is reported as interrupted immediately. A non-current server session with no heartbeat for three minutes is treated as a suspected cross-device interruption.
- A current session is never returned as an incident, even if the editor was asleep longer than the stale threshold. A resumed remote session clears its stale classification on its next heartbeat.
- Legacy or clean sessions remain stored for retention purposes but do not appear in the normal Files or Changes experience.

## Layer 3: explicit revisions

Recovery never invokes the canonical revision writer automatically. Healthy recovery activity has no sidebar progress or success UI. When an interrupted session is detected, Files shows a compact warning linking to an **Interrupted-session recovery** section in Changes. The existing recovery card offers:

- **Restore**: places recovered text into the editor as a dirty document.
- **Compare**: opens a current-versus-recovery diff.
- **Commit as New Revision**: explicitly creates the next version.
- **Apply to Active Revision**: explicitly updates the active version without incrementing it.
- **Discard Recovery**: removes the local safety copy and the current device's cloud generations without changing published files.

Publishing stages the verified recovery bytes with their original `baseVersion` and `baseHash`, then uses the existing extension file APIs. A changed server version, changed content hash, missing permission, or collaborator lock fails closed. Task-linked recovery also retains its task identifiers and uses the existing `replace_task_version` bookkeeping after the file revision succeeds.

## Operational invariants

1. Autosave writes safety copies only; it never publishes.
2. A cloud row is recoverable only after server-side checksum finalization.
3. A recovery publish always carries an explicit revision mode and stable idempotency key.
4. Local snapshots remain the offline source of truth; cloud copies are a second device/account safety layer.
5. Published success removes the local and cloud recovery copies for that device/file. Failed publication keeps them for retry.
6. Healthy snapshot writes and account uploads never trigger a full sidebar render.
7. Recovery action status is isolated from repository sync status and automatically clears after completion.
