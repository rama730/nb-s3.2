# Auth Canary Gates

## Rollout Stages

1. Stage A: 10%
2. Stage B: 50%
3. Stage C: 100%

Each stage must pass all gates before promotion.
Soak windows:

1. Stage A (10%): 24h
2. Stage B (50%): 24h
3. Stage C (100%): 72h stability confirmation

## Hard Gates

1. `auth.callback.exchange.failure` rate does not exceed baseline + 0.5%.
2. `auth.redirect.degraded_mode` does not show sustained growth for 15 minutes.
3. `auth.middleware.cookie_clear` does not spike above expected invalid-token baseline.
4. Login completion p95 latency remains within 20% of baseline.
5. `route.browser.load` p95 <= `APP_ROUTE_P95_LOAD_BUDGET_MS` (default `1500`).
6. `route.server.ttfb` p95 <= `APP_ROUTE_P95_TTFB_BUDGET_MS` (default `300`).

## Verification Checks

1. Google login from `/login?redirect=/hub` succeeds first attempt.
2. GitHub login from `/login?redirect=/hub` succeeds first attempt.
3. Email sign-in and sign-up follow same redirect contract.
4. Signed-out `/hub` access redirects to `/login?redirect=%2Fhub`.
5. Transient auth lookup failures do not force destructive sign-out.
6. Route baseline regression check passes (`npm run check:route-baseline-regression`).

## Rollback Trigger

Rollback immediately if any hard gate fails for 5 consecutive minutes.

## Rollback Action

1. Revert traffic to previous stable release.
2. Keep `AUTH_DEGRADED_MODE_ENABLED=1`.
3. Freeze promotion and capture callback + middleware logs by `requestId`.
