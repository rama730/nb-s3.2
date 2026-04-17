# Security Remediation Evidence

This document is the checked-in summary for the remaining security remediation branch. The release gate also generates `artifacts/security/remediation-report.json` from this summary so every release candidate leaves behind a machine-readable artifact.

## CSRF

- Signed double-submit CSRF cookies are issued in middleware and validated on state-changing routes.
- Same-origin browser requests attach the matching token header through the runtime provider.

## CSP

- Middleware sets a per-request CSP with a nonce.
- The app layout and Turnstile integration consume that nonce instead of relying on inline script exceptions.

## Upload lifecycle

- Direct project-file and profile-image uploads now begin with a server-issued upload intent.
- Uploaded objects must be finalized and verified before they become visible to node creation, profile image persistence, or application reads.
- Expired pending uploads are cleaned up through the upload-intent cleanup path.

## Profile/privacy

- Recovery-code state is private and separated from the public profile surface.
- Viewer-scoped profile serialization now gates restricted fields and `lastActiveAt` centrally.
- Discovery, network, direct profile reads, and DM read/open paths emit privacy read-audit events.

## E2E auth route

- The privileged E2E auth implementation lives in a development-only module.
- Production resolves `/api/e2e/auth` to a disabled 404 stub through a build-time alias in `next.config.ts`.

## Logging and hygiene

- Structured logs redact secret-bearing keys and restrict the allowed context shape.
- The remaining remediation work is release-gated by explicit contract scripts rather than best-effort convention.
