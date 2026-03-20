# ADR: Auth Snapshot

## Decision

Request-path authentication is resolved from the Supabase access token locally, using cached JWKS or the configured JWT secret, and exposed as `AuthSnapshot`.

## Why

- Remote auth lookups in middleware do not scale cleanly on hot paths.
- Route gating only needs verified claims, not a network round trip.
- A single request-path auth contract simplifies shell rendering and overload behavior.

## Consequences

- Middleware and server bootstraps must rely on `AuthSnapshot`, not remote `auth.getUser()` calls.
- Onboarding completion and email verification must be present in token-backed claims.
- Invalid or expired auth cookies fail closed and are cleared centrally.
