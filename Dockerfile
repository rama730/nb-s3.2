# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS builder

# NEXT_PUBLIC_* values are embedded into browser bundles by Next.js. Railway
# supplies these build arguments from the service variables with matching names.
ARG APP_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_YJS_WEBSOCKET_URL
ARG NEXT_PUBLIC_PRESENCE_WS_URL
ARG NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT

ENV APP_URL=$APP_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED=$NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_YJS_WEBSOCKET_URL=$NEXT_PUBLIC_YJS_WEBSOCKET_URL \
    NEXT_PUBLIC_PRESENCE_WS_URL=$NEXT_PUBLIC_PRESENCE_WS_URL \
    NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT=$NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# The worker executes reviewed Git operations at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
