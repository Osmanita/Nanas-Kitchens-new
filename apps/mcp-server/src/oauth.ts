/**
 * Story 5.4 (FR14) — OAuth 2.1 for external MCP clients.
 *
 * The MCP server doubles as the authorization server; the platform API stays the only
 * credential verifier (/auth/login, /auth/refresh). Flow per the MCP auth spec:
 *   1. Client hits the MCP endpoint without a token → 401 + WWW-Authenticate pointing at
 *      /.well-known/oauth-protected-resource.
 *   2. Client discovers the authorization server metadata, registers dynamically
 *      (public client, PKCE S256 required), and sends the buyer to /authorize.
 *   3. /authorize shows a login form; credentials are verified against the platform API
 *      and NEVER stored here — success mints a single-use 5-minute authorization code.
 *   4. /token exchanges code + PKCE verifier for an access token + a refresh token.
 *
 * What the two tokens are, and why they differ:
 *   access_token  IS the platform access token, forwarded unchanged to the resource server.
 *                 expires_in comes from that JWT's own exp claim (a hint for the client, never
 *                 trusted for a security decision) so it cannot drift out of sync again.
 *   refresh_token is minted HERE and means nothing to the platform. The 30-day, full-privilege
 *                 platform refresh token never leaves this process: it is held in `grants` and
 *                 swapped for a fresh access token on the client's behalf. Registration is open
 *                 (RFC 7591), so anyone can become a client — handing those clients the platform
 *                 credential would give every one of them an unrevocable 30-day key to the whole
 *                 account, indistinguishable from the one apps/web holds.
 *
 * MCP refresh tokens rotate and are single-use; presenting an already-rotated one means a copy
 * leaked, so the whole grant family — and the platform token inside it — is destroyed. RFC 7009
 * /revoke does the same on request, so a client's "disconnect" is real. Tokens are indexed by
 * SHA-256 and never held in the clear, so a heap dump or an accidentally logged map cannot be
 * replayed.
 *
 * Registrations, codes and grants are in-memory: they die with the process and are not shared
 * between instances, so a shared store is still needed before multi-instance deployment and a
 * restart forces every client to re-authorize. Everything is bounded and swept lazily on request
 * (no timers — a setInterval would keep the process alive) so an anonymous caller cannot grow
 * the heap without bound.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";

const CODE_TTL_MS = 5 * 60 * 1000;
// Mirrors the platform's refresh TTL (app.jwt.refresh-token-ttl-days: 30). If the stored
// platform token dies earlier, the next /auth/refresh fails and the grant is destroyed anyway.
const GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// A registration that never completes an authorization is free to create, so it does not get to
// hold a slot for a month. First code redemption promotes it to CLIENT_TTL_MS.
const UNUSED_CLIENT_TTL_MS = 60 * 60 * 1000;
// Only used when the access token's exp cannot be read; matches app.jwt.access-token-ttl-minutes: 480.
const ACCESS_TOKEN_TTL_FALLBACK_S = 8 * 60 * 60;
const ACCESS_TOKEN_TTL_MAX_S = 24 * 60 * 60;

const MAX_BODY_BYTES = 16 * 1024;
const MAX_CLIENT_NAME_LEN = 64;
const MAX_REDIRECT_URIS = 5;
const MAX_REDIRECT_URI_LEN = 512;
const MAX_CLIENTS = 1_000;
const MAX_CODES = 1_000;
const MAX_GRANTS = 5_000;
const MAX_FAMILY_TOKENS = 200;
const MAX_RATE_KEYS = 10_000;
const SWEEP_INTERVAL_MS = 60 * 1000;

// Generous on purpose: these stop scripted credential stuffing and drive-by registration
// floods, not a determined attacker (see clientIp — the key is spoofable behind a proxy).
const REGISTER_RATE = { max: 20, windowMs: 60 * 60 * 1000 };
const LOGIN_RATE = { max: 20, windowMs: 5 * 60 * 1000 };

// RFC 7591 §3 initial access token. Unset keeps registration open (the spec default, and what
// MCP clients expect); setting it makes the operator the gatekeeper before this faces the
// internet, without changing anything for a client that already holds a client_id.
const REGISTRATION_TOKEN = process.env.MCP_REGISTRATION_TOKEN ?? "";

interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  expiresAt: number;
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** One authorization: the platform refresh token plus every MCP token minted against it. */
interface Grant {
  clientId: string;
  platformRefreshToken: string;
  expiresAt: number;
  tokenHashes: string[];
}

interface RefreshRef {
  grantId: string;
  consumed: boolean;
}

const clients = new Map<string, RegisteredClient>();
const codes = new Map<string, PendingCode>();
const grants = new Map<string, Grant>();
const refreshIdx = new Map<string, RefreshRef>();
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

const b64url = (buf: Buffer) => buf.toString("base64url");
const s256 = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());
const sha256hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** Length is leaked, contents are not — every caller compares fixed-length digests or ids. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// ─── Grant bookkeeping ────────────────────────────────────────────────────────

function destroyGrant(grantId: string): void {
  const grant = grants.get(grantId);
  if (grant) for (const hash of grant.tokenHashes) refreshIdx.delete(hash);
  grants.delete(grantId);
}

/** Mints an opaque MCP refresh token and indexes it by hash under an existing grant. */
function mintRefreshToken(grantId: string, grant: Grant): string {
  const token = b64url(randomBytes(32));
  const hash = sha256hex(token);
  grant.tokenHashes.push(hash);
  // A long-forgotten rotation is dropped rather than remembered forever; replaying it then
  // reads as an unknown token instead of as reuse, which still fails the exchange.
  while (grant.tokenHashes.length > MAX_FAMILY_TOKENS) {
    const stale = grant.tokenHashes.shift();
    if (stale) refreshIdx.delete(stale);
  }
  refreshIdx.set(hash, { grantId, consumed: false });
  return token;
}

/**
 * TEST-ONLY. Hashing is applied symmetrically on write and on read, so dropping it changes
 * nothing a client can observe — every lookup still resolves and every status code stays the
 * same — while `refreshIdx` and `tokenHashes` quietly fill with replayable cleartext tokens.
 * A read-only copy of the keys is the only way a black-box test can see that. Returns a
 * snapshot, never the maps themselves, and never the platform token they point at.
 */
export function __tokenStoreSnapshotForTests(): { refreshIndexKeys: string[]; grantTokenHashes: string[] } {
  return {
    refreshIndexKeys: [...refreshIdx.keys()],
    grantTokenHashes: [...grants.values()].flatMap((grant) => [...grant.tokenHashes]),
  };
}

let lastSweepAt = 0;

function sweep(now: number, force = false): void {
  if (!force && now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  for (const [code, pending] of codes) if (pending.expiresAt <= now) codes.delete(code);
  for (const [grantId, grant] of grants) if (grant.expiresAt <= now) destroyGrant(grantId);

  const droppedClients = new Set<string>();
  for (const [clientId, client] of clients) {
    if (client.expiresAt <= now) {
      clients.delete(clientId);
      droppedClients.add(clientId);
    }
  }
  if (droppedClients.size > 0) {
    for (const [grantId, grant] of grants) if (droppedClients.has(grant.clientId)) destroyGrant(grantId);
  }

  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}

/**
 * Which X-Forwarded-For element to trust. A proxy APPENDS the peer address it actually saw, so
 * with one proxy in front the LAST element is the only one the client could not have written;
 * everything to its left is attacker-supplied text. Taking the first element (the usual reading
 * of "the original client") hands an anonymous caller an unlimited supply of rate-limit keys.
 *
 * MCP_TRUSTED_PROXIES is how many hops we own: 0 (default, no proxy) ignores the header
 * entirely, 1 suits the planned single ALB.
 */
function clientIp(req: IncomingMessage): string {
  // Read per call rather than once at module load. It is one parseInt of a string that never
  // changes for the life of the process, which costs nothing beside the request it serves — and
  // a value frozen at import time cannot be varied by a test, which left every line below the
  // early return unreachable and this whole choice of element uncovered.
  const TRUSTED_PROXIES = Number.parseInt(process.env.MCP_TRUSTED_PROXIES ?? "0", 10) || 0;
  const socketIp = req.socket.remoteAddress || "unknown";
  if (TRUSTED_PROXIES <= 0) return socketIp.slice(0, 64);
  const raw = req.headers["x-forwarded-for"];
  const chain = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // Count back past the hops we own; a short chain means nobody spoofed anything, so the
  // socket address is still the honest answer.
  const hop = chain[chain.length - TRUSTED_PROXIES];
  return (hop || socketIp).slice(0, 64);
}

function rateLimited(key: string, limit: { max: number; windowMs: number }, now: number): boolean {
  const bucket = rateBuckets.get(key);
  if (bucket && bucket.resetAt > now) {
    bucket.count += 1;
    return bucket.count > limit.max;
  }
  // Bound at insertion, not in sweep(): sweep self-throttles to once a minute, so a flood that
  // arrives faster than that would have the map to itself in between. Map iteration order is
  // insertion order, so evicting from the front drops the oldest keys.
  while (rateBuckets.size >= MAX_RATE_KEYS) {
    const oldest = rateBuckets.keys().next().value;
    if (oldest === undefined) break;
    rateBuckets.delete(oldest);
  }
  rateBuckets.set(key, { count: 1, resetAt: now + limit.windowMs });
  return false;
}

// ─── Small HTTP helpers ───────────────────────────────────────────────────────

export function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  // RFC 6749 §5.1: token responses carry credentials and must never be cached.
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, status: number, body: string): void {
  // The consent page is browser-navigated, never fetched cross-origin: letting a script read it
  // (CORS) or frame it (clickjack the submit button) only ever helps an attacker.
  res.removeHeader("Access-Control-Allow-Origin");
  res.removeHeader("Access-Control-Allow-Methods");
  res.removeHeader("Access-Control-Allow-Headers");
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    pragma: "no-cache",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

class PayloadTooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new PayloadTooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLarge();
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads exp out of the platform JWT for expires_in. Display hint only — nothing gates on it. */
function accessTokenTtlSeconds(accessToken: string): number {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return ACCESS_TOKEN_TTL_FALLBACK_S;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const exp = (payload as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return ACCESS_TOKEN_TTL_FALLBACK_S;
    const ttl = Math.floor(exp - Date.now() / 1000);
    if (ttl <= 0 || ttl > ACCESS_TOKEN_TTL_MAX_S) return ACCESS_TOKEN_TTL_FALLBACK_S;
    return ttl;
  } catch {
    return ACCESS_TOKEN_TTL_FALLBACK_S;
  }
}

function tokenPair(body: unknown): { accessToken: string; refreshToken: string } | null {
  const pair = body as { accessToken?: unknown; refreshToken?: unknown } | null;
  if (!pair || typeof pair.accessToken !== "string" || typeof pair.refreshToken !== "string") return null;
  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
}

/**
 * Truncated and stripped of control characters: this string is unauthenticated input rendered
 * on a page that asks the buyer for a platform password.
 */
function sanitizeClientName(raw: string | undefined): string {
  if (raw === undefined) return "MCP client";
  const printable = Array.from(raw, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f ? " " : ch;
  }).join("");
  const cleaned = printable.slice(0, MAX_CLIENT_NAME_LEN).trim();
  return cleaned === "" ? "MCP client" : cleaned;
}

/** OAuth 2.1 §2.3.1 / MCP auth spec: https, or http on loopback for native clients. */
function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REDIRECT_URI_LEN) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.hash || parsed.username || parsed.password) return false;
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname);
}

// ─── Login form (server-rendered, no client secrets involved) ─────────────────

function loginForm(params: URLSearchParams, clientName: string, error?: string): string {
  const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"]
    .map((k) => `<input type="hidden" name="${k}" value="${esc(params.get(k) ?? "")}">`)
    .join("\n      ");
  let destination = params.get("redirect_uri") ?? "";
  try {
    destination = new URL(destination).host;
  } catch {
    // Registration already rejects unparseable URIs; show the raw string rather than nothing.
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Nanas' Kitchens — Authorize</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; background: #faf3e4; color: #24281f; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  .card { background: #fff; border: 1px solid #e5decb; border-radius: 16px; padding: 32px; width: min(360px, 90vw); }
  h1 { font-size: 20px; margin: 0 0 4px; color: #2e4a2e; }
  p { font-size: 14px; color: #6b7280; margin: 0 0 16px; }
  label { font-size: 14px; display: block; margin-bottom: 12px; }
  input[type=email], input[type=password] { width: 100%; box-sizing: border-box; padding: 10px 12px; margin-top: 4px; border: 1px solid #e5decb; border-radius: 10px; font-size: 15px; }
  button { width: 100%; padding: 12px; background: #e8720c; color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; }
  .error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 10px; padding: 10px 14px; font-size: 14px; margin-bottom: 16px; }
  .warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; border-radius: 10px; padding: 10px 14px; font-size: 13px; margin-bottom: 12px; }
  .facts { font-size: 13px; color: #4b5563; border: 1px solid #e5decb; border-radius: 10px; padding: 10px 14px; margin-bottom: 20px; overflow-wrap: anywhere; }
  .facts div { margin: 2px 0; }
  .facts span { color: #9ca3af; display: inline-block; min-width: 96px; }
</style></head>
<body>
  <div class="card">
    <h1>Nanas&rsquo; Kitchens</h1>
    <p>An application wants to sign in as you and order food on your behalf.</p>
    <div class="warn">Unverified: anyone can register an application here. The name below was
      chosen by whoever registered it and has not been checked by Nanas&rsquo; Kitchens. Only
      continue if you started this yourself.</div>
    <div class="facts">
      <div><span>Application</span>&ldquo;${esc(clientName)}&rdquo;</div>
      <div><span>Sends you to</span>${esc(destination)}</div>
    </div>
    ${error ? `<div class="error">${esc(error)}</div>` : ""}
    <form method="post" action="/authorize">
      ${hidden}
      <label>Email <input type="email" name="email" required autofocus></label>
      <label>Password <input type="password" name="password" required></label>
      <button type="submit">Log in &amp; authorize</button>
    </form>
  </div>
</body></html>`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

/** Handles OAuth endpoints; returns false when the path belongs to the MCP transport. */
export async function handleOAuth(
  req: IncomingMessage,
  res: ServerResponse,
  baseUrl: string,
  apiUrl: string,
): Promise<boolean> {
  try {
    return await route(req, res, baseUrl, apiUrl);
  } catch (e) {
    // server.ts awaits this from an `async` createServer listener that has no catch of its own,
    // so an escaping rejection is fatal under Node's default policy — one malformed request
    // would take down every other client's session and the in-memory stores with it.
    if (res.headersSent) {
      res.end();
      return true;
    }
    if (e instanceof PayloadTooLarge) {
      json(res, 413, { error: "invalid_request", error_description: "Request body too large" });
      return true;
    }
    process.stderr.write(`OAuth request failed: ${e instanceof Error ? e.message : String(e)}\n`);
    json(res, 500, { error: "server_error" });
    return true;
  }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  baseUrl: string,
  apiUrl: string,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", baseUrl);
  const now = Date.now();
  sweep(now);

  // RFC 8414 §3.1 allows the issuer path as a suffix; the old startsWith also answered on
  // /.well-known/oauth-authorization-serverANYTHING and on every path below it.
  const issuerPath = new URL(baseUrl).pathname.replace(/\/+$/, "");
  const wellKnown = (name: string) => [`/.well-known/${name}`, `/.well-known/${name}${issuerPath}`];

  // RFC 9728 — points 401'd MCP clients at the authorization server. `resource` names this
  // server; the access token itself is the platform's and carries no audience binding to it.
  if (wellKnown("oauth-protected-resource").includes(url.pathname)) {
    json(res, 200, {
      resource: baseUrl,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
    });
    return true;
  }

  // RFC 8414 authorization server metadata.
  if (wellKnown("oauth-authorization-server").includes(url.pathname)) {
    json(res, 200, {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      revocation_endpoint: `${baseUrl}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
    });
    return true;
  }

  // RFC 7591 dynamic client registration (public clients only).
  if (url.pathname === "/register" && req.method === "POST") {
    if (REGISTRATION_TOKEN) {
      const presented = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (!safeEqual(presented, REGISTRATION_TOKEN)) {
        json(res, 401, { error: "invalid_token" });
        return true;
      }
    }
    if (rateLimited(`register:${clientIp(req)}`, REGISTER_RATE, now)) {
      json(res, 429, { error: "invalid_request", error_description: "Too many registrations" });
      return true;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      if (e instanceof PayloadTooLarge) throw e;
      json(res, 400, { error: "invalid_client_metadata" });
      return true;
    }
    // JSON.parse happily returns null, a number or an array; reading members off those threw
    // past the try/catch above and, with no error boundary, killed the process.
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      json(res, 400, { error: "invalid_client_metadata" });
      return true;
    }
    const metadata = body as { redirect_uris?: unknown; client_name?: unknown };
    const redirectUris = metadata.redirect_uris;
    const clientName = metadata.client_name;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.length > MAX_REDIRECT_URIS ||
      !redirectUris.every(isAllowedRedirectUri)
    ) {
      json(res, 400, {
        error: "invalid_redirect_uri",
        error_description: "1-5 https URIs (or http on loopback), no fragment, no userinfo",
      });
      return true;
    }
    if (clientName !== undefined && typeof clientName !== "string") {
      json(res, 400, { error: "invalid_client_metadata" });
      return true;
    }

    if (clients.size >= MAX_CLIENTS) {
      sweep(now, true);
      // Still full means the map is full of entries that have not expired yet, and answering
      // 503 would keep every legitimate client out until they do. Evict the oldest instead:
      // a flood then costs the attacker its own earlier registrations, not everyone else's
      // ability to onboard. Insertion order makes the front of the map the oldest.
      while (clients.size >= MAX_CLIENTS) {
        const oldest = clients.keys().next().value;
        if (oldest === undefined) break;
        clients.delete(oldest);
        for (const [grantId, grant] of grants) if (grant.clientId === oldest) destroyGrant(grantId);
      }
    }
    const client: RegisteredClient = {
      clientId: randomBytes(16).toString("hex"),
      clientName: sanitizeClientName(clientName),
      redirectUris: redirectUris as string[],
      // A registration nobody ever uses is the cheap thing to make: give it an hour, and let
      // the first successful code redemption promote it to the full client lifetime.
      expiresAt: now + UNUSED_CLIENT_TTL_MS,
    };
    clients.set(client.clientId, client);
    json(res, 201, {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    return true;
  }

  if (url.pathname === "/authorize" && req.method === "GET") {
    const client = clients.get(url.searchParams.get("client_id") ?? "");
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    if (!client || !client.redirectUris.includes(redirectUri)) {
      html(res, 400, "<p>Unknown client or redirect_uri — register first.</p>");
      return true;
    }
    if (url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge")) {
      html(res, 400, "<p>PKCE S256 is required.</p>");
      return true;
    }
    html(res, 200, loginForm(url.searchParams, client.clientName));
    return true;
  }

  if (url.pathname === "/authorize" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const client = clients.get(form.get("client_id") ?? "");
    const redirectUri = form.get("redirect_uri") ?? "";
    if (!client || !client.redirectUris.includes(redirectUri)) {
      html(res, 400, "<p>Unknown client or redirect_uri.</p>");
      return true;
    }
    // The GET enforced PKCE but nothing binds the two requests, so re-check here: a POST-only
    // caller could otherwise park a code with an empty challenge.
    if (form.get("code_challenge_method") !== "S256" || !form.get("code_challenge")) {
      html(res, 400, "<p>PKCE S256 is required.</p>");
      return true;
    }
    // This endpoint forwards arbitrary credentials to a platform that has no lockout of its
    // own — unthrottled it is a public brute-force front end for every account on it.
    if (rateLimited(`login:${clientIp(req)}`, LOGIN_RATE, now)) {
      html(res, 429, loginForm(form, client.clientName, "Too many attempts — wait a few minutes."));
      return true;
    }

    // Verify credentials against the platform — the only identity source (NFR3 spirit).
    const login = await fetch(`${apiUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    }).catch(() => null);
    if (!login || !login.ok) {
      html(res, 401, loginForm(form, client.clientName, "Wrong email or password — try again."));
      return true;
    }
    const tokens = tokenPair(await login.json().catch(() => null));
    if (!tokens) {
      html(res, 502, loginForm(form, client.clientName, "The platform returned an unexpected response."));
      return true;
    }

    if (codes.size >= MAX_CODES) {
      sweep(now, true);
      if (codes.size >= MAX_CODES) {
        html(res, 503, "<p>Too many authorizations in flight — try again in a few minutes.</p>");
        return true;
      }
    }
    const code = randomBytes(24).toString("base64url");
    codes.set(code, {
      clientId: client.clientId,
      redirectUri,
      codeChallenge: form.get("code_challenge") ?? "",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: now + CODE_TTL_MS,
    });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    const state = form.get("state");
    if (state) target.searchParams.set("state", state);
    res.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
    res.end();
    return true;
  }

  if (url.pathname === "/token" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const grantType = form.get("grant_type");

    if (grantType === "authorization_code") {
      const presentedCode = form.get("code") ?? "";
      const pending = codes.get(presentedCode);
      codes.delete(presentedCode); // single use, success or not
      const clientId = form.get("client_id") ?? "";
      if (
        !pending ||
        pending.expiresAt < now ||
        !safeEqual(pending.clientId, clientId) ||
        !clients.has(clientId) ||
        (form.get("redirect_uri") ?? "") !== pending.redirectUri ||
        !safeEqual(s256(form.get("code_verifier") ?? ""), pending.codeChallenge)
      ) {
        json(res, 400, { error: "invalid_grant" });
        return true;
      }

      if (grants.size >= MAX_GRANTS) {
        sweep(now, true);
        // Same reasoning as the client cap: 30-day grants mean "still full after a sweep" is
        // the normal case under a flood, and 503 here would lock every real buyer out of the
        // code exchange for a month. Drop the oldest authorization instead.
        while (grants.size >= MAX_GRANTS) {
          const oldest = grants.keys().next().value;
          if (oldest === undefined) break;
          destroyGrant(oldest);
        }
      }
      // This client got as far as a real login, so it is worth the full retention window.
      const client = clients.get(clientId);
      if (client) client.expiresAt = now + CLIENT_TTL_MS;
      // The platform refresh token stops here; the client only ever sees the opaque MCP one.
      const grantId = randomBytes(16).toString("hex");
      const grant: Grant = {
        clientId: pending.clientId,
        platformRefreshToken: pending.refreshToken,
        expiresAt: now + GRANT_TTL_MS,
        tokenHashes: [],
      };
      grants.set(grantId, grant);
      const refreshToken = mintRefreshToken(grantId, grant);

      json(res, 200, {
        access_token: pending.accessToken,
        token_type: "Bearer",
        expires_in: accessTokenTtlSeconds(pending.accessToken),
        refresh_token: refreshToken,
      });
      return true;
    }

    if (grantType === "refresh_token") {
      const presented = form.get("refresh_token") ?? "";
      const clientId = form.get("client_id") ?? "";
      const ref = presented ? refreshIdx.get(sha256hex(presented)) : undefined;
      if (!ref) {
        json(res, 400, { error: "invalid_grant" });
        return true;
      }
      if (ref.consumed) {
        // Rotation is single-use, so a second presentation means a copy of this token exists
        // somewhere it should not. Kill the family, and the platform token inside it.
        destroyGrant(ref.grantId);
        json(res, 400, { error: "invalid_grant" });
        return true;
      }
      const grant = grants.get(ref.grantId);
      if (!grant || grant.expiresAt < now) {
        destroyGrant(ref.grantId);
        json(res, 400, { error: "invalid_grant" });
        return true;
      }
      // OAuth 2.1 §4.3.1: a refresh token is bound to the client it was issued to. Not treated
      // as reuse — a wrong client_id is far more often a misconfigured client than an attack,
      // and the token itself is the secret that gates the platform call below.
      const client = clients.get(clientId);
      if (!client || !safeEqual(grant.clientId, clientId)) {
        json(res, 400, { error: "invalid_grant" });
        return true;
      }

      // Burn the token HERE, in the synchronous block, not after the await below. Two
      // presentations that overlap in flight would otherwise both pass the checks above and
      // both spend the same platform refresh token: either the platform rejects the second and
      // the grant is destroyed under a client that merely retried, or both succeed and the
      // grant ends up with two live unconsumed tokens — one of them the thief's — after which
      // no already-rotated token is ever presented again and the reuse detection above can
      // never fire. The authorization_code branch already consumes before its first await.
      ref.consumed = true;
      const platformRefreshToken = grant.platformRefreshToken;

      const refresh = await fetch(`${apiUrl}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: platformRefreshToken }),
      }).catch(() => null);
      if (!refresh || !refresh.ok) {
        // The stored credential is dead (rotated elsewhere, revoked, expired); keeping the
        // grant would only leave an unusable platform token sitting in memory.
        destroyGrant(ref.grantId);
        json(res, 400, { error: "invalid_grant" });
        return true;
      }
      const tokens = tokenPair(await refresh.json().catch(() => null));
      if (!tokens) {
        // The platform rotated its side but we cannot read the new credential, so the one we
        // hold is already dead. Drop the grant rather than leave a burnt token pointing at it.
        destroyGrant(ref.grantId);
        json(res, 502, { error: "server_error" });
        return true;
      }

      grant.platformRefreshToken = tokens.refreshToken;
      grant.expiresAt = now + GRANT_TTL_MS;
      client.expiresAt = now + CLIENT_TTL_MS;
      const rotated = mintRefreshToken(ref.grantId, grant);

      json(res, 200, {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: accessTokenTtlSeconds(tokens.accessToken),
        refresh_token: rotated,
      });
      return true;
    }

    json(res, 400, { error: "unsupported_grant_type" });
    return true;
  }

  // RFC 7009 — makes a client's "disconnect" real. Answers 200 for unknown tokens by design,
  // so it cannot be used to probe which tokens are still live.
  if (url.pathname === "/revoke" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const presented = form.get("token") ?? "";
    const ref = presented ? refreshIdx.get(sha256hex(presented)) : undefined;
    const grant = ref ? grants.get(ref.grantId) : undefined;
    if (ref && grant && safeEqual(grant.clientId, form.get("client_id") ?? "")) destroyGrant(ref.grantId);
    json(res, 200, {});
    return true;
  }

  return false; // not an OAuth path — hand over to the MCP transport
}
