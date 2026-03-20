# Load Suite

These scripts exercise the hardened read paths and the authenticated shell routes without depending on local browser tooling.

Environment:
- `BASE_URL`
- `AUTH_COOKIE` for authenticated routes, formatted as a full `Cookie` header value such as `sb-access-token=...; sb-refresh-token=...`
- `PRESENCE_ROOM_ID` and optional `PRESENCE_ROOM_TYPE` for presence-room validation
- `PRESENCE_WS_LOAD_URL` when the presence service is not returned directly from the token route
- `WORKER_LOAD_URL` for the worker plane probe suite

Suggested runs:
- `k6 run qa/load/public-projects-feed.k6.js`
- `k6 run -e AUTH_COOKIE="..." qa/load/authenticated-shells.k6.js`
- `k6 run -e AUTH_COOKIE="..." qa/load/workspace-bootstrap.k6.js`
- `k6 run -e AUTH_COOKIE="..." qa/load/messages-reconnect-storm.k6.js`
- `k6 run -e AUTH_COOKIE="..." -e PRESENCE_ROOM_ID="project-id" qa/load/presence-room-fanout.k6.js`
- `k6 run -e AUTH_COOKIE="..." -e WORKER_LOAD_URL="https://worker.example.com/api/v1/inngest" qa/load/worker-isolation.k6.js`
- `k6 run qa/load/auth-entry-pages.k6.js`
- `npm run run:load-suite -- --base-url=https://staging.example.com --auth-cookie="sb-access-token=...; sb-refresh-token=..."`

Notes:
- `public-projects-feed.k6.js` targets the cache-first anonymous feed path.
- `authenticated-shells.k6.js` keeps `/hub`, `/workspace`, and `/messages` under sustained shell traffic.
- `workspace-bootstrap.k6.js` isolates the profile-backed workspace bootstrap path.
- `messages-reconnect-storm.k6.js` simulates reconnect/page-entry churn on the active messaging surface.
- `auth-entry-pages.k6.js` verifies the public auth and verification shells can absorb unauthenticated load.
- `presence-room-fanout.k6.js` exercises token issuance plus WebSocket join/heartbeat behavior for the dedicated presence plane.
- `worker-isolation.k6.js` keeps authenticated shell traffic active while probing the worker-plane ingress separately.
- The wrapper command writes normalized reports to `reports/stability/load/latest.json`.
