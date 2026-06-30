# Production Alert Thresholds

Last updated: 2026-06-19

These thresholds turn the security and stability checklist into observable production policy. Wire each rule into the active alerting backend and keep the alert name identical to the names below so rollout reports can reference them.

## Required Alert Policies

| Alert | Signal | Window | Threshold | Severity | Owner |
| --- | --- | --- | --- | --- | --- |
| `auth.callback.exchange.failure.rate` | `auth.callback.exchange.failure / auth.callback.exchange.attempt` | 5 minutes | greater than baseline + 0.5 percentage points or greater than 2% absolute | page | platform |
| `auth.middleware.degraded_mode.spike` | `auth.redirect.degraded_mode` count | 15 minutes | greater than 3x trailing 24h same-window baseline | page | platform |
| `auth.middleware.lookup.timeout.rate` | `auth.middleware.lookup.timeout / auth.middleware.lookup.attempt` | 5 minutes | greater than 1% | ticket, page if paired with login errors | platform |
| `webhook.github.signature.failure.rate` | GitHub webhook signature failures | 5 minutes | greater than 5 failures or greater than 1% of webhook volume | page | integrations |
| `api.v1.error_rate` | 5xx responses from `/api/v1/*` | 5 minutes | greater than 1% and at least 20 requests | page | platform |
| `route.server.ttfb.p95` | route TTFB p95 | 10 minutes | greater than `APP_ROUTE_P95_TTFB_BUDGET_MS` for 3 windows | ticket, page for active surfaces | frontend |
| `route.browser.load.p95` | browser route load p95 | 10 minutes | greater than `APP_ROUTE_P95_LOAD_BUDGET_MS` for 3 windows | ticket | frontend |
| `worker.queue.retry_saturation` | Inngest retries or dead-letter count | 10 minutes | greater than 2x baseline or any dead-letter burst above 10 | page | workers |
| `presence.reconnect_storm` | presence reconnects per active room | 10 minutes | greater than 3x baseline | page | realtime |

## Required Alert Dimensions

Every alert query must preserve these labels when the backend supports them:

- `environment`
- `service`
- `route`
- `requestId`
- `userId` only when already sanitized or hashed
- `failureKind`
- `hardeningPhase`

## Triage Order

1. Confirm the alert is not caused by a deploy or vendor incident already in progress.
2. Open the related dashboard from `ops/stability/production-rollout.json`.
3. Compare the failing metric with request IDs in structured logs.
4. If auth, webhook, or API error gates fail for 5 consecutive minutes, freeze promotion.
5. If user-facing errors are sustained, run the rollback steps in `docs/operations/credential-rotation-and-rollback.md`.

## Rollout Gates

The production rollout cannot move from one stage to the next unless:

- all alert policies above are installed in the active alerting provider
- the previous stage completed its soak period
- no page-severity alert fired during the soak window
- the latest release, load, and capacity reports are healthy
