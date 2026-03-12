# Security Checklist

Last updated: 2026-03-12

## 1. Identity and Auth

- [x] Canonical auth redirect base URL is centralized (`APP_URL` / `NEXT_PUBLIC_APP_URL`).
- [x] OAuth callback ownership is centralized in `/auth/callback`.
- [x] `next` redirect path is normalized and restricted to internal relative paths.
- [x] Middleware uses degraded mode on transient auth lookup failures (no destructive cookie clear).
- [x] Auth cookies are cleared only for explicit invalid-token failures.
- [x] Request correlation ID is attached to callback and middleware auth metrics.
- [x] Runtime auth decisions are isolated from E2E fallback cookies/test impersonation paths.
- [x] Auth baseline + regression checkpoints are documented (`docs/auth-stability-baseline.md`).

## 2. CSRF Protection

- [x] Shared CSRF helper blocks missing `Origin` / `Host` headers.
- [x] Shared CSRF helper blocks origin/host mismatch.
- [x] State-changing account security routes enforce CSRF checks.
- [x] Admin reserved-username POST/DELETE now enforce shared CSRF checks.

## 3. Secrets and Credential Handling

- [x] No plaintext secrets were found in source via static secret-pattern scan.
- [x] GitHub access tokens are no longer passed in git CLI args for import/sync clone/push.
- [x] Git auth now uses ephemeral `GIT_ASKPASS` credentials with cleanup.
- [ ] Confirm all CI/CD logs redact env vars and command env.

## 4. Dependency Security

- [x] Updated `next` to a patched version (`16.1.6`).
- [x] Updated `simple-git` to a patched version (`3.33.0`).
- [x] Removed unused `rxdb` stack (`rxdb`, `rxjs`, `tus-js-client`) and deleted dead local RxDB modules.
- [x] Upgraded `typescript-eslint` chain to `8.57.0`, removing vulnerable `minimatch@9.x`.
- [x] Migrated `drizzle-kit` to `1.0.0-beta.6-7419dcb` to remove legacy `@esbuild-kit/*` + vulnerable `esbuild` transitive path.
- [x] Current `npm audit` baseline: `0` vulnerabilities (prod + dev).

## 5. API Route Security

- [x] Webhook endpoint validates HMAC signature (`x-hub-signature-256`).
- [x] Auth/session/account routes have consistent structured logging with request IDs.
- [x] Project listing API avoids leaking sensitive env var names in client-facing error messages.
- [ ] Review non-browser API callers for compatibility with strict CSRF origin checks.

## 6. Storage and File Security

- [x] Path traversal protections are present (`appendSafePathSegment`, `resolvePathUnderRoot`).
- [x] Inline file fetch size protection includes metadata and runtime blob-size fallback.
- [x] Signed URL creation paths validate read access and clamp TTL.
- [ ] Add scheduled scan for orphaned storage objects and failed reconciliation retries.

## 7. Observability and Incident Readiness

- [x] Structured metrics exist for auth lookup/callback failures.
- [x] Route-level logging includes status/action/duration and request IDs.
- [x] Canary gate thresholds and rollback triggers are documented (`docs/operations/auth-canary-gates.md`).
- [ ] Add alert thresholds for auth callback failures, middleware degraded-mode spikes, and webhook signature failures.
- [ ] Add runbook section for credential rotation and rollback process.

## 8. Secure SDLC Gates

- [x] Unit test suite passes.
- [x] Full typecheck passes (`npm run typecheck`).
- [x] Added automated `npm audit --omit=dev --audit-level=high` gate (`check:deps:audit`).
- [x] Added lockfile drift check gate (`check:deps:lockfile`).
- [x] Added periodic dependency PR automation (`.github/dependabot.yml`).

## Recommended Recurrence

- On every PR:
  - `npm run test:unit`
  - `npm audit --omit=dev`
  - Targeted static scans for auth/csrf/token handling
- Weekly:
  - Dependency review and patch window
  - Webhook/auth log anomaly review
- Monthly:
  - CSRF coverage review for all mutating endpoints
  - Secret scanning and credential rotation drill
