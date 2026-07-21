# Extension Runtime Observability

This runbook covers the VS Code-compatible NB Workspace extension flow:

- Browser authorization issues a short-lived `nb_auth_...` code.
- The editor exchanges that code once through `/api/v1/extension/auth-code`.
- Workspace, folder, task, file, lock, and sync routes authenticate with the stored `nb_dev_...` device token.
- Large file reads use a signed download URL plus byte ranges.
- Large file saves use `/api/v1/extension/file-upload` to create a signed upload intent, upload directly to storage, and finalize the version through the API.
- Unsaved text uses `/api/v1/extension/recovery-drafts` for private, checksum-verified account recovery without creating a file revision.
- Recovery-session start, heartbeat, and clean-close state uses `/api/v1/extension/recovery-sessions` to distinguish silent current snapshots from interrupted-session incidents.

## Recovery protection signals

- `extension.recovery.session` records start, heartbeat, and clean-close outcomes without file paths or draft content.
- Healthy local/account snapshot success remains diagnostic-only and must not generate user-facing sidebar activity.
- Repeated cloud failures remain silent during bounded retries; after five minutes Changes may show one stable “account backup delayed” warning while local protection remains active.
- Local snapshot failures are higher priority because they compromise the primary safety layer and surface once until a successful snapshot clears the condition.

## Required Dashboards

Use `ops/stability/extension-dashboard.json` as the source of truth for panel names, grouping dimensions, and alert thresholds.

Minimum panels:

- Auth-code exchange success rate and p95 latency.
- Extension workspace bootstrap p95 latency.
- Signed download intent p95 latency.
- Signed range probe p95 latency from `qa/load/extension-sync.k6.js`.
- Large upload intent and finalize success rates.
- Large upload finalize p95 latency.
- Recovery intent/finalize success rate and p95 latency.
- Webview error/warn log counts by action.

## Load Probe

Run against staging with a revocable extension token and a representative file path:

```bash
STABILITY_LOAD_SUITES=extension-sync \
EXTENSION_TOKEN="nb_dev_..." \
EXTENSION_PROJECT_ID="00000000-0000-0000-0000-000000000000" \
EXTENSION_FILE_PATH="/README.md" \
npm run run:load-suite -- --base-url=https://staging.example.com
```

The probe is intentionally read-oriented. It verifies bearer auth, workspace bootstrap, signed download intent creation, and signed byte-range reads without creating project versions.

## Triage

If auth-code exchange failures spike:

1. Check whether the browser callback is returning `code` and `state`.
2. Confirm the extension version is at least `1.0.36`.
3. Inspect `extension_device_session_events` for `auth_code_issued` without matching `auth_code_consumed`.
4. Verify `EXTENSION_AUTH_CODE_SECRET` is stable across app instances.

If signed range latency spikes:

1. Compare `extension.file.download_intent` latency with `extension_signed_range_ms`.
2. If intent latency is low and range latency is high, investigate storage/CDN egress.
3. If both are high, inspect database access on `project_nodes`, `file_versions`, and project membership lookups.

If upload finalize fails:

1. Check for `Checksum mismatch`, `File size mismatch`, or lock conflict responses.
2. Confirm the extension is sending the latest base version/hash.
3. Check whether the upload intent expired before finalize.
4. Confirm storage object reads are healthy from the app region.

If recovery uploads fail:

1. Confirm migrations `0100_extension_recovery_drafts` and `0102_extension_recovery_sessions` are applied and the private `extension-recovery-drafts` bucket exists.
2. Compare `extension.recovery.intent` and `extension.recovery.finalize` failures. Intent failures point to auth/access/storage setup; finalize failures point to missing bytes, size drift, or checksum mismatch.
3. Confirm the editor still has a valid device token. Local current/previous snapshots continue working while offline.
4. Check the `extension-recovery-retention` heartbeat before investigating expired drafts; finalized drafts expire after 30 days and retain the newest three generations per device/file.
