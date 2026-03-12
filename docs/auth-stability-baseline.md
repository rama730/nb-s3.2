# Auth Stability Baseline

Recorded on: 2026-03-12

## Baseline Scenarios

1. `/login?redirect=/hub` with email sign-in -> redirects to `/hub` (or middleware-owned onboarding route when not onboarded).
2. `/signup?redirect=/hub` with immediate session creation -> redirects to `/hub` (or middleware-owned onboarding route when not onboarded).
3. OAuth callback success with safe `next` -> redirects to normalized internal path.
4. OAuth callback failure/missing code -> redirects to `/login?error=auth-code-error&redirect=<safe-next>`.
5. Middleware timeout/transient auth lookup with auth cookies -> no destructive sign-out redirect (degraded mode).
6. Middleware invalid-token auth lookup -> clears auth cookies and enforces auth redirects.

## Regression Checkpoints

1. Canonical base URL resolution must succeed from `APP_URL`/`NEXT_PUBLIC_APP_URL` in production.
2. `normalizeAuthNextPath` must block all external or malformed redirect targets.
3. Runtime auth route guards must not depend on test fallback cookies.
4. Callback and middleware metrics must include request correlation fields (`requestId`) and duration.

## Evidence Commands

1. `npm run test:unit -- auth-redirects auth-session-lookup auth-e2e-fallback`
2. `npm run typecheck -- --pretty false`
3. Manual callback check:
   - `/auth/callback?next=/hub` (no code) -> login error redirect.
4. Manual protected-route check:
   - Signed out -> `/hub` redirects to `/login?redirect=%2Fhub`.
