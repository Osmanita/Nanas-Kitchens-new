# syntax=docker/dockerfile:1
#
# MCP server (:3002).
#
# Build from the REPO ROOT, not from this directory:
#   docker build -f apps/mcp-server/Dockerfile -t nanas/mcp-server .
#
# !! TRANSPORT=http is set below on purpose. The server defaults to stdio
#    (src/server.ts:317) for Claude Desktop; a container with a stdio transport listens
#    on nothing and the health check never passes.
#
# !! The OAuth grant store is IN-MEMORY (E5). With more than one task, a client
#    authorised against task A is unknown to task B and re-authorises on every other
#    request. Keep desired count at 1 until that store is shared.

ARG NODE_VERSION=22
ARG PNPM_VERSION=9.12.0

# ---------- build ----------
FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
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

RUN pnpm install --frozen-lockfile --filter mcp-server...

COPY apps/mcp-server/ apps/mcp-server/
RUN pnpm --filter mcp-server build

# ---------- runtime ----------
# A second, production-only install rather than copying the builder's node_modules:
# this package has no native modules and no codegen, so a clean --prod tree is both
# smaller and exactly what runs. (apps/api cannot do this — see its Dockerfile.)
FROM node:${NODE_VERSION}-alpine AS runtime
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY packages/core/package.json packages/core/

# No tsconfig.base.json here: nothing is compiled in this stage, only installed.
RUN pnpm install --frozen-lockfile --prod --filter mcp-server...

COPY --from=build /repo/apps/mcp-server/dist apps/mcp-server/dist

ENV NODE_ENV=production
ENV TRANSPORT=http
ENV MCP_PORT=3002

USER node
EXPOSE 3002

WORKDIR /repo/apps/mcp-server
CMD ["node", "dist/server.js"]
