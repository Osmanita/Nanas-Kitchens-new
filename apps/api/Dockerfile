# syntax=docker/dockerfile:1
#
# Legacy NestJS API (:3001) — being strangled by apps/api-java, but it still owns the
# Prisma schema and the seed, so it is not optional yet (E2).
#
# Build from the REPO ROOT, not from this directory:
#   docker build -f apps/api/Dockerfile -t nanas/api .
#
# Schema migrations do NOT run from this image. Use Dockerfile.migrate as a one-shot
# ECS task before the service rolls — see that file.

ARG NODE_VERSION=22
ARG PNPM_VERSION=9.12.0

# ---------- build ----------
# Debian, not Alpine, and this is not a style choice:
#   - argon2 (auth.service.ts) is a native addon. Prebuilds exist for glibc; on musl it
#     has to be compiled from source, which drags in python3/make/g++.
#   - Prisma's query engine picks a binary target per libc. Generating on glibc and
#     running on glibc keeps that a non-question.
FROM node:${NODE_VERSION}-slim AS build
ARG PNPM_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# apps/{api,mcp-server}/tsconfig.json and packages/core/tsconfig.json all `extends`
# this. Without it tsc does not fail loudly -- it falls back to compiler defaults,
# loses skipLibCheck, starts type-checking every .d.ts under node_modules and dies
# with a JS heap OOM. Copy it with the manifests, not with the sources: it changes
# about as often as they do.
COPY tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY packages/core/package.json packages/core/

RUN pnpm install --frozen-lockfile --filter api...

COPY packages/core/ packages/core/
COPY apps/api/ apps/api/

# @culture-eats/core resolves to dist/index.js, so it has to exist before api compiles.
RUN pnpm --filter @culture-eats/core build

# MUST be explicit, and MUST come before the build. @prisma/client's own postinstall
# runs from the workspace root, cannot find apps/api/prisma/schema.prisma, and quietly
# emits an untyped STUB client — apps/api then fails to compile with ~8 TS errors. This
# is the exact bug that turned CI red on 2026-08-08; ci.yml and dev.ps1 carry the same
# step for the same reason. `migrate deploy` does NOT generate a client.
RUN pnpm --filter api prisma:generate

RUN pnpm --filter api build

# ---------- runtime ----------
# The whole built workspace is carried over instead of a fresh --prod install (which is
# what apps/mcp-server does). Reason: a --prod tree would drop the prisma CLI, and the
# generated client lives inside the pnpm store rather than in apps/api/node_modules, so
# re-creating it in a slim stage means re-running codegen without its own tooling. The
# cost is devDependencies riding along in the image.
# Worth revisiting later with `pnpm deploy --filter=api --prod` plus a pinned
# `prisma generate` in the deployed tree — but only with a working Docker to test it.
FROM node:${NODE_VERSION}-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

COPY --from=build /repo /repo

ENV NODE_ENV=production
ENV API_PORT=3001

USER node
EXPOSE 3001

WORKDIR /repo/apps/api
CMD ["node", "dist/main.js"]
