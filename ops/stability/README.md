# Stability Ops Artifacts

These files capture environment-specific proof that does not belong in application code.

Use these templates:
- `capacity-audit.example.json`
- `production-rollout.example.json`
- `extension-dashboard.json`

Create filled-in copies without the `.example` suffix before running the strict checks:
- `ops/stability/capacity-audit.json`
- `ops/stability/production-rollout.json`

Committed rollout control:
- `production-rollout.json`

The committed rollout plan is intentionally `pending` until real staging, load, capacity, and on-call evidence is attached. Keep environment-specific vendor ceilings in `capacity-audit.json`, which should not be guessed.

Extension runtime dashboards and alerts are defined in `extension-dashboard.json`; the companion runbook lives at `docs/operations/extension-runtime-observability.md`.

The capacity audit also requires one billing-period Supabase usage snapshot,
forecast, aggregate attribution coverage, signed-URL reuse rate, room peak,
owner/project Storage concentration, documented fixture bytes, soft budgets,
and warning/critical ownership for every quota-bearing metric. Never include
user IDs, object keys, tokens, or raw query text in these artifacts.
