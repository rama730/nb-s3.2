# Auth Stability Runbook

Last updated: 2026-03-12

## 1) Canonical Auth Contract (Frozen)

This contract is non-negotiable for all auth entrypoints.

1. OAuth start emits a callback URL built from canonical app base (`APP_URL` server, `NEXT_PUBLIC_APP_URL` client fallback).
2. Redirect intent is always normalized by `normalizeAuthNextPath` and must be internal (`/...`) only.
3. `/auth/callback` is the single owner of `exchangeCodeForSession(code)` and final redirect.
4. Middleware is the single owner of route guarding and onboarding gating.
5. Runtime auth decisions do not use E2E custom fallback cookies.

## 2) Required Environment Variables

- `APP_URL` (required in production for server canonical base URL)
- `NEXT_PUBLIC_APP_URL` (required client canonical base URL fallback)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional tuning:

- `AUTH_MIDDLEWARE_LOOKUP_TIMEOUT_MS` (default `4000`)
- `AUTH_MIDDLEWARE_PROFILE_TIMEOUT_MS` (default `2500`)
- `AUTH_DEGRADED_MODE_ENABLED` (default `true`)
- `AUTH_HARDENING_PHASE` (default `9`; used for rollout/observability tagging)
- `APP_ROUTE_P95_LOAD_BUDGET_MS` (default `1500`)
- `APP_ROUTE_P95_TTFB_BUDGET_MS` (default `300`)
- `ROUTE_BASELINE_REGRESSION_CHECK` (default `true`)
- `ROUTE_BASELINE_LOAD_MAX_REGRESSION_RATIO` (default `0.35`)
- `ROUTE_BASELINE_TTFB_MAX_REGRESSION_RATIO` (default `0.5`)

JWT verification note:

- If your Supabase project uses symmetric (`HS*`) JWT signing, set `SUPABASE_JWT_SECRET` to keep request-path verification local.
- If `SUPABASE_JWT_SECRET` is absent, the app now falls back to a verified Supabase `getUser()` lookup instead of clearing valid auth cookies, but that fallback is slower and should be treated as a development or transitional mode.

## 3) Local, Staging, Production Setup

### Local

1. Use `http://localhost:3000` as canonical browser URL.
2. Start with `pnpm dev`.
3. Local browser `Not Secure` indicator is expected for HTTP mode.
4. Local OAuth now preserves the active browser origin during the handshake, but the safest path is still to start and finish on the same origin for the full sign-in flow.

### Supabase Auth Redirect Allowlist

Must include all deployed callback URLs:

- `http://localhost:3000/auth/callback`
- `http://127.0.0.1:3000/auth/callback` when you open local dev on `127.0.0.1`
- `https://<staging-domain>/auth/callback`
- `https://<production-domain>/auth/callback`

If you use a different local origin during development, that exact `.../auth/callback` URL must also be allowlisted in Supabase Auth.

## 4) Degraded Mode and Cookie-Clear Policy

Middleware lookup failures are classified:

- `timeout`
- `transient`
- `invalid_token`

Behavior:

1. `invalid_token`: clear auth cookies and continue strict auth redirect behavior.
2. `timeout` or `transient`: preserve cookies and enter degraded mode.
3. In degraded mode with auth cookies present, avoid destructive redirects that can trigger login loops.

## 5) Rollout Plan (Phased Canary)

Use staged rollout with metric gates:

1. Stage A: 10% traffic
2. Stage B: 50% traffic
3. Stage C: 100% traffic

For each stage:

1. Hold for a soak window.
2. Validate metrics are below threshold.
3. Roll back immediately if gates fail.

Gate definitions are tracked in `docs/operations/auth-canary-gates.md`.

Rollback controls:

- Set `AUTH_DEGRADED_MODE_ENABLED=true` to preserve safe degraded behavior.
- Revert rollout routing to previous stable deployment.

## 6) Metrics and Correlation IDs

Required auth metrics:

- `auth.oauth.start`
- `auth.callback.exchange.success`
- `auth.callback.exchange.failure`
- `auth.middleware.lookup.success`
- `auth.middleware.lookup.timeout`
- `auth.middleware.lookup.error`
- `auth.middleware.cookie_clear`
- `auth.redirect.degraded_mode`

Required metric fields:

- `requestId` (callback + middleware mandatory)
- `path`
- `nextPath` (normalized)
- `failureKind` (where applicable)
- `durationMs`
- `phase` or `hardeningPhase`

## 7) Failure Triage

### Symptom: repeated OAuth prompt / login loop

1. Check callback failures by `requestId`.
2. Check middleware `auth.redirect.degraded_mode` spikes.
3. Confirm canonical `APP_URL` and callback allowlist entries.
4. Verify `next` is normalized and not external/malformed.

### Symptom: unexpected sign-outs

1. Check `auth.middleware.cookie_clear` count.
2. Confirm failures are truly `invalid_token` and not transient.
3. Inspect timeout/transient rates around same period.

### Symptom: callback 500

1. Confirm `APP_URL` / `NEXT_PUBLIC_APP_URL` are configured in the active environment.
2. Verify Supabase URL/anon key presence.

## 8) Verification Checklist

Before promotion to next canary stage:

1. OAuth login succeeds first-attempt for Google and GitHub.
2. Email sign-in/sign-up follows same redirect contract.
3. Protected routes redirect signed-out users to login with safe `redirect`.
4. Transient auth lookup failures do not cause cookie clear or login loop.
5. Invalid token still clears cookies and redirects correctly.
6. `npm run check:page-contract` and `npm run check:force-dynamic-allowlist` pass.
7. `npm run check:route-baseline-regression` passes after critical E2E run.
