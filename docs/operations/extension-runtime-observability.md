# Extension Runtime Observability

This runbook covers the VS Code-compatible NB Workspace extension flow:

- Browser authorization issues a short-lived `nb_auth_...` code.
- The editor exchanges that code once through `/api/v1/extension/auth-code`.
- Workspace, folder, task, file, lock, and sync routes authenticate with the stored `nb_dev_...` device token.
- Large file reads use a signed download URL plus byte ranges.
- Large file saves use `/api/v1/extension/file-upload` to create a signed upload intent, upload directly to storage, and finalize the version through the API.

## Required Dashboards

Use `ops/stability/extension-dashboard.json` as the source of truth for panel names, grouping dimensions, and alert thresholds.

Minimum panels:

- Auth-code exchange success rate and p95 latency.
- Extension workspace bootstrap p95 latency.
- Signed download intent p95 latency.
- Signed range probe p95 latency from `qa/load/extension-sync.k6.js`.
- Large upload intent and finalize success rates.
- Large upload finalize p95 latency.
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
