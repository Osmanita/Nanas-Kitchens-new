import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * This service never loaded its own .env — no ConfigModule, no dotenv anywhere in src. It only
 * ever worked because dev.cmd exports the file into the process before starting it, so anyone
 * launching it any other way (`pnpm --filter api start`, the seed script, a container with no
 * env file mounted) hit the same crash: DATABASE_URL undefined, and the JWT strategy throwing
 * because JWT_SECRET has had no fallback since the fail-closed change.
 *
 * apps/api/.env first, then the repo root: dotenv never overwrites a variable that is already
 * set, so the local file wins where the two disagree and a real export still beats both. Paths
 * are relative to this file's directory at runtime — dist/ when compiled, src/ under ts-node,
 * both one level below apps/api.
 *
 * Import for its side effect BEFORE anything that reads process.env.
 */
const CANDIDATES = [
  resolve(__dirname, "../.env"),
  resolve(__dirname, "../../../.env"),
];

for (const path of CANDIDATES) {
  if (existsSync(path)) {
    config({ path });
  }
}
