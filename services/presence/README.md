# Presence Service

This service is the dedicated ephemeral realtime plane for:

- cursor updates
- typing indicators
- presence heartbeats

It is intentionally separate from the Next.js request runtime.

## Contract

- HTTP health endpoint: `GET /health`
- WebSocket endpoint: `GET /ws?token=<presence-token>`
- Token issuer: [src/app/api/realtime/presence-token/route.ts](/Users/chrama/Downloads/nb-s3/src/app/api/realtime/presence-token/route.ts)

## Environment

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `PRESENCE_TOKEN_SECRET`
- `PRESENCE_SERVICE_PORT`
- `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` for metrics

## Local Run

```bash
npm run presence:dev
```
