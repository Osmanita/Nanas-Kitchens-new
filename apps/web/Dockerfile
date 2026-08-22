# syntax=docker/dockerfile:1
#
# Next.js frontend (:3000).
#
# Build from the REPO ROOT, not from this directory:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#     -t nanas/web .
#
# !! NEXT_PUBLIC_API_URL IS BAKED IN AT BUILD TIME (apps/web/lib/api.ts:7).
#    Next.js inlines NEXT_PUBLIC_* into the client bundle during `next build`, so
#    setting it as an ECS task-definition environment variable does NOTHING. Point one
#    image at one API origin. When the domain is finally bought, this image has to be
#    rebuilt — it cannot be re-pointed.

ARG NODE_VERSION=22
ARG PNPM_VERSION=9.12.0

# ---------- deps ----------
# Manifests only, so `pnpm install` re-runs when a dependency changes but not when a
# component does. All four workspace manifests are copied because --frozen-lockfile
# validates every importer in pnpm-lock.yaml, even the ones this image will not build.
FROM node:${NODE_VERSION}-alpine AS deps
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY packages/core/package.json packages/core/

RUN pnpm install --frozen-lockfile --filter web...

# ---------- build ----------
FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1
# Opts next.config.ts into output: "standalone". It is gated behind this variable
# because producing standalone output needs symlink creation, which fails with EPERM
# on a stock Windows dev box — see the comment in next.config.ts.
ENV NEXT_OUTPUT_STANDALONE=1

COPY apps/web/ apps/web/
RUN pnpm --filter web build

# ---------- runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# HOSTNAME must be 0.0.0.0, not the default localhost, or the ALB health check cannot
# reach the container across the task's network namespace.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# outputFileTracingRoot is the repo root, so standalone/ mirrors the workspace layout
# and the entrypoint lands at apps/web/server.js. Static assets and public/ are NOT
# included in standalone output — Next expects them copied in beside it.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

# `node` (uid 1000) ships with the image; nothing here is written at runtime.
USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
