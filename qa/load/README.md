# Load Suite

These scripts exercise the hardened read paths and the authenticated shell routes without depending on local browser tooling.

Environment:
- `BASE_URL`
- `AUTH_COOKIE` for authenticated routes, formatted as a full `Cookie` header value such as `sb-access-token=...; sb-refresh-token=...`
- `WORKER_LOAD_URL` for the worker plane probe suite
- `EXTENSION_TOKEN`, `EXTENSION_PROJECT_ID`, and `EXTENSION_FILE_PATH` for the extension sync probe

Suggested runs:
- `k6 run qa/load/public-projects-feed.k6.js`
- `k6 run -e AUTH_COOKIE="..." qa/load/authenticated-shells.k6.js`
- `k6 run -e AUTH_COOKIE="..." qa/load/workspace-bootstrap.k6.js`
- `k6 run -e AUTH_COOKIE="..." qa/load/messages-route-entry-churn.k6.js`
- `k6 run -e SUPABASE_REALTIME_URL="..." -e SUPABASE_ANON_KEY="..." -e SUPABASE_ACCESS_TOKEN="..." -e REALTIME_TOPIC="presence:conversation:<id>" qa/load/realtime-reconnect.k6.js`
- `k6 run -e AUTH_COOKIE="..." -e WORKER_LOAD_URL="https://worker.example.com/api/v1/inngest" qa/load/worker-isolation.k6.js`
- `k6 run -e EXTENSION_TOKEN="nb_dev_..." -e EXTENSION_PROJECT_ID="..." -e EXTENSION_FILE_PATH="/README.md" qa/load/extension-sync.k6.js`
- `k6 run qa/load/auth-entry-pages.k6.js`
- `npm run run:load-suite -- --base-url=https://staging.example.com --auth-cookie="sb-access-token=...; sb-refresh-token=..."`
- `STABILITY_LOAD_SUITES=extension-sync EXTENSION_TOKEN="nb_dev_..." EXTENSION_PROJECT_ID="..." EXTENSION_FILE_PATH="/README.md" npm run run:load-suite -- --base-url=https://staging.example.com`

Notes:
- `public-projects-feed.k6.js` targets the cache-first anonymous feed path.
- `authenticated-shells.k6.js` keeps `/hub`, `/workspace`, and `/messages` under sustained shell traffic.
- `workspace-bootstrap.k6.js` isolates the profile-backed workspace bootstrap path.
- `messages-route-entry-churn.k6.js` measures repeated authenticated messaging route entry.
- `realtime-reconnect.k6.js` opens native private Realtime sockets, joins channels, sends a bounded probe, reconnects, and records join latency/failures/duplicates.
- `auth-entry-pages.k6.js` verifies the public auth and verification shells can absorb unauthenticated load.
- `worker-isolation.k6.js` keeps authenticated shell traffic active while probing the worker-plane ingress separately.
- `extension-sync.k6.js` exercises the extension bearer auth workspace route, signed file download intent, and signed range transfer path.
- The wrapper command writes normalized reports to `reports/stability/load/latest.json`.
