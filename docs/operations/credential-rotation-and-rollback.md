# Credential Rotation And Rollback

Last updated: 2026-06-19

This runbook covers planned rotation and emergency rollback for production credentials, auth configuration, webhooks, and worker/realtime secrets.

## Roles

- Incident commander: owns the timeline, customer impact notes, and rollback decision.
- Platform owner: rotates app, Supabase, Redis, storage, and OTEL credentials.
- Integrations owner: rotates GitHub webhook and import/sync credentials.
- Worker owner: validates Inngest, Git sync, and background queue recovery.

## Planned Rotation

1. Create the replacement secret in the provider without deleting the old secret.
2. Add the new value to the deployment platform as a staged environment variable.
3. Deploy with dual-read or backward-compatible validation when the integration supports it.
4. Run `npm run check:stability-env -- --target=production --strict`.
5. Run a targeted smoke test for the affected path.
6. Promote the new secret to active use.
7. Remove the old secret only after one full monitoring window with no errors.

## Emergency Rotation

1. Freeze deploy promotion and open an incident.
2. Revoke the compromised credential at the provider.
3. Create and deploy the replacement credential.
4. Rotate dependent webhook signatures, OAuth callback settings, worker tokens, and realtime secrets in the same incident window when they share blast radius.
5. Run targeted production smoke checks:
   - auth sign-in and callback
   - GitHub webhook delivery
   - upload signed URL creation
   - worker enqueue and completion
   - presence token issuance
6. Keep the incident open until alert windows return to baseline.

## Rollback

1. Set traffic back to the previous stable deployment.
2. Keep `AUTH_DEGRADED_MODE_ENABLED=true` during auth incidents so transient lookup failures do not force sign-outs.
3. Disable the rollout target or feature flag that introduced the incident.
4. Confirm `/api/v1/ready`, `/api/v1/health`, auth callback, and the active route class dashboards are healthy.
5. Capture the failing release ID, request IDs, alert windows, and remediation owner in the incident record.

## Evidence To Attach

- release ID and deployment URL
- changed secret names, never secret values
- alert screenshots or query links
- smoke-test results
- rollback command or platform action
- owner and timestamp for old-secret revocation
