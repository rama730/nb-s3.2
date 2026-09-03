# NetworkBase production deployment

This runbook describes the single production system for `networkbase.in`.
There is no standing staging environment and no additional Supabase project.

## Architecture

- GoDaddy remains the domain registrar.
- Cloudflare is the authoritative DNS provider.
- One Railway project contains two services built from this repository.
- The `networkbase-web` service receives public traffic.
- The `networkbase-worker` service exposes the authenticated Inngest endpoint.
- Both services use the existing Supabase, Upstash Redis, and Inngest resources.

## Required Railway service settings

Create both services from the same GitHub repository and production branch.
Railway detects the root `Dockerfile` automatically.

For `networkbase-web`:

- `INNGEST_EXECUTION_ROLE=web`
- Public domain: `networkbase.in`
- Health check: `/api/v1/live`

For `networkbase-worker`:

- `INNGEST_EXECUTION_ROLE=worker`
- Keep the generated Railway domain because Inngest must reach the endpoint.
- Health check: `/api/v1/live`

Do not enable Railway PR environments and do not add production secrets to any
preview deployment.

## Canonical URLs

Set the following on both services:

```text
APP_URL=https://networkbase.in
NEXT_PUBLIC_APP_URL=https://networkbase.in
```

The worker's generated domain is transport-only. It is not an application
canonical URL.

## Secrets

Copy production values from the local environment into Railway through the
encrypted Variables interface. Never commit values to this repository. The web
and worker services use the same values except for `INNGEST_EXECUTION_ROLE`.

Keep `E2E_AUTH_FALLBACK`, `NEXT_PUBLIC_E2E_AUTH_FALLBACK`, and
`E2E_ALLOW_PRIMARY_DATABASE` unset or false in production.

## Supabase Auth

Set the production Site URL to:

```text
https://networkbase.in
```

Allow these exact callback URLs:

```text
http://localhost:3000/auth/callback
https://networkbase.in/auth/callback
```

## Cloudflare and GoDaddy

1. Add `networkbase.in` to Cloudflare.
2. Confirm Cloudflare's DNS scan before changing nameservers.
3. Replace the GoDaddy nameservers with the two assigned by Cloudflare.
4. Wait until Cloudflare marks the zone Active.
5. Add the Railway verification and target records exactly as Railway displays.
6. Keep verification records DNS-only.
7. Validate Railway origin TLS before enabling the Cloudflare proxy.
8. Use Cloudflare SSL/TLS mode `Full (strict)`.
9. Redirect `www.networkbase.in` to `https://networkbase.in`.

## Release and rollback

Before deployment, run:

```text
npm run typecheck
npm run build
```

Do not run E2E fixture cleanup, database replay, or experimental migrations
against the existing Supabase database.

For an application rollback, redeploy the last healthy Railway deployment. For
a DNS rollback, restore the previously recorded nameservers and DNS records.
Application rollback does not reverse a database migration.
