# syntax=docker/dockerfile:1
#
# Staging / production image for wacrm (Next.js standalone).
# Build from the repo root:
#   docker build -f deploy/staging/Dockerfile \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://wa.astraconnect.io \
#     --build-arg NEXT_PUBLIC_SUPABASE_DB_SCHEMA=wacrm \
#     --build-arg NEXT_PUBLIC_STORAGE_BUCKET_PREFIX=wacrm- \
#     -t wacrm-staging .
#
# NEXT_PUBLIC_* values are inlined at build time (including schema +
# bucket prefix for the shared Voice project). Server secrets are
# runtime-only — never bake them into the image.

# ---------------------------------------------------------------
# Stage 1 — install dependencies
# ---------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL=https://wa.astraconnect.io
ARG NEXT_PUBLIC_APP_LOCALE=en
# Shared-project schema isolation — must be present at `next build` or
# the browser bundle defaults to Voice's `public` schema / unprefixed buckets.
ARG NEXT_PUBLIC_SUPABASE_DB_SCHEMA
ARG NEXT_PUBLIC_STORAGE_BUCKET_PREFIX
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE \
    NEXT_PUBLIC_SUPABASE_DB_SCHEMA=$NEXT_PUBLIC_SUPABASE_DB_SCHEMA \
    NEXT_PUBLIC_STORAGE_BUCKET_PREFIX=$NEXT_PUBLIC_STORAGE_BUCKET_PREFIX \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------
# Stage 3 — minimal runtime (standalone output)
# ---------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok||r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
