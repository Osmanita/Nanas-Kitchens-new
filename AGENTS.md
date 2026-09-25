# Repository Guidelines

## Project Structure

This pnpm workspace is a monorepo for Nanas' Kitchens. `apps/api-java` is the primary
Spring Boot API (auth, kitchens, menus, orders, payments, delivery, and chat) on port
8080. `apps/web` is the Next.js frontend on port 3000. `apps/mcp-server` exposes the MCP
interface; `apps/api` is the legacy NestJS/Prisma service and owns Prisma migrations and
seed data. Shared TypeScript contracts live in `packages/core`. Architecture, product
requirements, and story acceptance criteria are in `docs/`.

## Build, Test, and Development Commands

Use Node with pnpm 9.12 (`corepack` or the pinned package manager). Typical setup is:

```text
pnpm install
docker compose up -d                 # PostGIS and Redis
pnpm --filter api prisma:generate
pnpm --filter api prisma:migrate:deploy
pnpm --filter api seed
```

On Windows, prefer `scripts/dev.ps1` to load `.env`, migrate, and start services. The
workspace commands `pnpm build`, `pnpm test`, and `pnpm lint` build all packages, run all
tests, and run ESLint respectively. Use `pnpm stripe:listen` for local Stripe sandbox
webhooks; never use live keys during development.

## Coding Style and Naming

TypeScript/React uses two-space indentation, semicolons, and ESLint rules from the root
configuration. Components and Java classes use PascalCase; functions, variables, routes,
and files use camelCase or the existing kebab-case route convention. Java follows standard
Spring naming and keeps DTOs under the owning feature package. Run `pnpm lint` before a PR.

## Testing Guidelines

Web and MCP tests use Vitest; the legacy API uses Jest; Java tests use Maven/Spring test
support. Name tests after the behavior they cover and keep integration tests explicit
about required Docker services. Run `pnpm test`, or a focused command such as
`pnpm --filter web test` or `apps/api-java/mvnw.cmd test`.

## Commits and Pull Requests

History favors short, imperative subjects with an optional scope or story prefix, such as
`CI: typecheck seed` or `E5: move OAuth storage to Redis`. Keep commits focused. A PR should
describe the user-visible behavior and implementation, link the relevant story or issue,
list validation commands, and include screenshots for UI changes. Call out migrations,
environment variables, webhook changes, and any deployment steps.

## Security and Configuration

Never commit `.env`, API keys, webhook secrets, JWT secrets, or customer data. Copy
`.env.example` and generate local secrets. Spring does not read `.env` automatically, so
use `scripts/dev.ps1` or explicitly export variables before starting Java. Preserve the
existing provider interfaces and verify Stripe webhook signatures with the configured
secret.
