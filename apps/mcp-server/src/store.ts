/**
 * Shared state for the OAuth server, in Redis.
 *
 * This used to be five module-level Maps. That worked exactly as long as there was one
 * process: with two, a client registered on task A is unknown to task B, an authorization
 * code issued by A cannot be redeemed on B, and — worst of the three — a refresh token
 * rotated on A still looks live on B, so reuse detection never fires and the family is never
 * destroyed. None of that shows up on a single instance, which is why it survived this long.
 *
 * Keys are namespaced under `mcp:` and every one of them carries a TTL, which is also what
 * replaced the old hand-rolled lazy sweep: expiry is the database's job now, not ours.
 */
// Named import, not default: ioredis is CJS and under NodeNext the default binding resolves
// to the module namespace, which is not constructable.
import { Redis } from "ioredis";

/**
 * Read per call, not frozen at import. Same reason clientIp() reads MCP_TRUSTED_PROXIES per
 * call: a value captured at module load cannot be varied by a test, and the test suite needs
 * its own namespace so a run cannot touch a developer's live store.
 */
const prefix = () => process.env.MCP_REDIS_PREFIX ?? "mcp:";

let client: Redis | null = null;

/** Lazily connected so importing this module never opens a socket (tests, `--help`, ...). */
export function redis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    client.on("error", (err: Error) => console.error(`[oauth-store] redis: ${err.message}`));
  }
  return client;
}

export async function closeStore(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}

const k = {
  client: (id: string) => `${prefix()}client:${id}`,
  code: (code: string) => `${prefix()}code:${code}`,
  grant: (id: string) => `${prefix()}grant:${id}`,
  grantTokens: (id: string) => `${prefix()}grant:${id}:tokens`,
  refresh: (hash: string) => `${prefix()}refresh:${hash}`,
  rate: (key: string) => `${prefix()}rate:${key}`,
  count: (kind: string) => `${prefix()}count:${kind}`,
};

/** Seconds remaining until `expiresAt`, floored at 1 — Redis rejects a TTL of 0. */
function ttlFrom(expiresAt: number, now: number): number {
  return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

async function getJson<T>(key: string): Promise<T | undefined> {
  const raw = await redis().get(key);
  return raw ? (JSON.parse(raw) as T) : undefined;
}

// ─── Clients, codes, grants ───────────────────────────────────────────────────

export async function getClient<T>(id: string): Promise<T | undefined> {
  return getJson<T>(k.client(id));
}

export async function putClient(id: string, value: unknown, expiresAt: number, now: number): Promise<void> {
  await redis().set(k.client(id), JSON.stringify(value), "EX", ttlFrom(expiresAt, now));
}

export async function getCode<T>(code: string): Promise<T | undefined> {
  return getJson<T>(k.code(code));
}

export async function putCode(code: string, value: unknown, expiresAt: number, now: number): Promise<void> {
  await redis().set(k.code(code), JSON.stringify(value), "EX", ttlFrom(expiresAt, now));
}

/**
 * Redeeming an authorization code must be single-use, and the check and the delete cannot be
 * two round trips: two requests arriving together would both read the same live code and both
 * redeem it. GETDEL is one atomic operation, so exactly one caller gets the value.
 */
export async function takeCode<T>(code: string): Promise<T | undefined> {
  const raw = await redis().getdel(k.code(code));
  return raw ? (JSON.parse(raw) as T) : undefined;
}

export async function getGrant<T>(id: string): Promise<T | undefined> {
  return getJson<T>(k.grant(id));
}

export async function putGrant(id: string, value: unknown, expiresAt: number, now: number): Promise<void> {
  await redis().set(k.grant(id), JSON.stringify(value), "EX", ttlFrom(expiresAt, now));
}

/** Drops the grant, its token list, and every refresh token indexed under it. */
export async function destroyGrant(id: string): Promise<void> {
  const hashes = await redis().lrange(k.grantTokens(id), 0, -1);
  const pipeline = redis().multi();
  pipeline.del(k.grant(id));
  pipeline.del(k.grantTokens(id));
  for (const hash of hashes) pipeline.del(k.refresh(hash));
  await pipeline.exec();
}

// ─── Refresh tokens ───────────────────────────────────────────────────────────

/**
 * Records a freshly minted refresh token under its grant and trims the family to `maxFamily`.
 * A long-forgotten rotation is dropped rather than remembered forever; replaying it then reads
 * as an unknown token instead of as reuse, which still fails the exchange.
 */
export async function indexRefreshToken(
  grantId: string,
  hash: string,
  expiresAt: number,
  now: number,
  maxFamily: number,
): Promise<void> {
  const ttl = ttlFrom(expiresAt, now);
  const listKey = k.grantTokens(grantId);
  await redis()
    .multi()
    .set(k.refresh(hash), JSON.stringify({ grantId, consumed: false }), "EX", ttl)
    .rpush(listKey, hash)
    .expire(listKey, ttl)
    .exec();

  const overflow = (await redis().llen(listKey)) - maxFamily;
  for (let i = 0; i < overflow; i += 1) {
    const stale = await redis().lpop(listKey);
    if (stale) await redis().del(k.refresh(stale));
  }
}

/** Non-consuming lookup, for /revoke — revoking must not count as a use. */
export async function peekRefreshToken(
  hash: string,
): Promise<{ grantId: string; consumed: boolean } | undefined> {
  return getJson<{ grantId: string; consumed: boolean }>(k.refresh(hash));
}

export type ConsumeResult =
  | { outcome: "unknown" }
  | { outcome: "reuse"; grantId: string }
  | { outcome: "ok"; grantId: string };

/**
 * Check-and-burn in ONE atomic step, which is the whole reason this is a Lua script.
 *
 * The in-memory version set `ref.consumed = true` before its first await, and that ordering
 * was load-bearing: two presentations that overlap in flight would otherwise both pass the
 * checks and both spend the same platform refresh token — either the platform rejects the
 * second and the grant dies under a client that merely retried, or both succeed and the grant
 * is left with two live tokens, one of them the thief's, after which no rotated token is ever
 * presented again and reuse detection can never fire.
 *
 * Split across GET-then-SET that hole comes straight back, and wider: the two requests need
 * not even be on the same instance. KEEPTTL so burning a token does not extend its life.
 */
const CONSUME_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'unknown' end
local ref = cjson.decode(raw)
if ref.consumed then return 'reuse:' .. ref.grantId end
ref.consumed = true
redis.call('SET', KEYS[1], cjson.encode(ref), 'KEEPTTL')
return 'ok:' .. ref.grantId
`;

export async function consumeRefreshToken(hash: string): Promise<ConsumeResult> {
  const raw = (await redis().eval(CONSUME_LUA, 1, k.refresh(hash))) as string;
  if (raw === "unknown") return { outcome: "unknown" };
  const [outcome, grantId] = [raw.slice(0, raw.indexOf(":")), raw.slice(raw.indexOf(":") + 1)];
  return outcome === "reuse" ? { outcome: "reuse", grantId } : { outcome: "ok", grantId };
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

/**
 * INCR against a key that expires on its own. Only the first request in a window sets the
 * expiry, so the window is fixed from that first hit rather than sliding forward on every
 * request — a caller cannot hold a bucket open by keeping the pressure on.
 */
export async function bumpRate(key: string, windowMs: number): Promise<number> {
  const redisKey = k.rate(key);
  const count = await redis().incr(redisKey);
  if (count === 1) await redis().pexpire(redisKey, windowMs);
  return count;
}

// ─── Caps ─────────────────────────────────────────────────────────────────────

/**
 * Cheap DoS ceiling on how many clients/codes/grants may exist at once. Kept as an approximate
 * counter rather than a SCAN: it is a guard against unbounded growth, and a count that drifts
 * slightly under churn still guards that. Rebuilt from reality whenever it trips.
 */
export async function underCap(kind: "clients" | "codes" | "grants", max: number): Promise<boolean> {
  const key = k.count(kind);
  const count = Number((await redis().get(key)) ?? 0);
  if (count < max) return true;
  const actual = await countKeys(`${prefix()}${kind === "clients" ? "client" : kind.slice(0, -1)}:*`);
  await redis().set(key, String(actual));
  return actual < max;
}

export async function bumpCount(kind: "clients" | "codes" | "grants"): Promise<void> {
  await redis().incr(k.count(kind));
}

async function countKeys(pattern: string): Promise<number> {
  let cursor = "0";
  let total = 0;
  do {
    const [next, keys] = await redis().scan(cursor, "MATCH", pattern, "COUNT", 500);
    cursor = next;
    total += keys.length;
  } while (cursor !== "0");
  return total;
}

// ─── Test support ─────────────────────────────────────────────────────────────

/** Wipes only this prefix, so a test run cannot touch anything else sharing the Redis. */
export async function __flushStoreForTests(): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys] = await redis().scan(cursor, "MATCH", `${prefix()}*`, "COUNT", 500);
    cursor = next;
    if (keys.length) await redis().del(...keys);
  } while (cursor !== "0");
}

export async function __refreshIndexKeysForTests(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis().scan(cursor, "MATCH", `${prefix()}refresh:*`, "COUNT", 500);
    cursor = next;
    keys.push(...batch.map((key: string) => key.slice(`${prefix()}refresh:`.length)));
  } while (cursor !== "0");
  return keys;
}

export async function __grantTokenHashesForTests(): Promise<string[]> {
  const hashes: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis().scan(cursor, "MATCH", `${prefix()}grant:*:tokens`, "COUNT", 500);
    cursor = next;
    for (const key of batch) hashes.push(...(await redis().lrange(key, 0, -1)));
  } while (cursor !== "0");
  return hashes;
}
