/**
 * OAuth 2.1 authorization server tests — no database, no network, no listening socket.
 * handleOAuth() is driven directly with fake IncomingMessage/ServerResponse objects and a
 * stubbed global fetch standing in for the platform API (/auth/login, /auth/refresh).
 *
 * These cases aim at the credential boundary rather than the happy path: the platform refresh
 * token must never reach anything a client can read, and the MCP refresh token that replaces it
 * must be single-use, bound to one client, and revocable.
 *
 * The module under test holds its clients/codes/grants in module-level maps that survive between
 * cases, so every test registers its own client and every request carries a unique rate-limit IP.
 * The clock-shifting cases live last: they leave the module's lazy sweep timestamp in the future,
 * which is harmless (every expiry is also re-checked inline) but is not worth making an earlier
 * test depend on.
 */

import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __tokenStoreSnapshotForTests, handleOAuth, setCors } from "./oauth.js";

const BASE = "http://localhost:3002";
const API = "http://localhost:8080";
const REDIRECT = "https://client.example/cb";
const BUYER = { email: "buyer@demo.com", password: "demo1234" };

/** The credential the whole fix exists to contain: it must never appear in a response body. */
const PLATFORM_REFRESH = "platform-refresh-30d-full-privilege";
/** Mirrors ACCESS_TOKEN_TTL_FALLBACK_S — deliberately duplicated so a silent drift fails here. */
const ACCESS_TOKEN_TTL_FALLBACK_S = 8 * 60 * 60;

// ─── Fake req/res ─────────────────────────────────────────────────────────────

interface RequestOptions {
  form?: Record<string, string>;
  json?: unknown;
  raw?: string;
  ip?: string;
  headers?: Record<string, string>;
}

class FakeRes {
  statusCode = 0;
  headersSent = false;
  body = "";
  readonly headers: Record<string, string> = {};

  setHeader(name: string, value: string | number): void {
    this.headers[name.toLowerCase()] = String(value);
  }
  removeHeader(name: string): void {
    delete this.headers[name.toLowerCase()];
  }
  writeHead(status: number, headers?: Record<string, string | number>): this {
    this.statusCode = status;
    this.headersSent = true;
    for (const [key, value] of Object.entries(headers ?? {})) this.headers[key.toLowerCase()] = String(value);
    return this;
  }
  end(chunk?: string): void {
    if (chunk !== undefined) this.body += chunk;
  }
  json<T = Record<string, any>>(): T {
    return JSON.parse(this.body) as T;
  }
}

let ipCounter = 0;
/** Distinct per request so one test's traffic cannot spend another's rate-limit budget. */
const nextIp = () => `198.51.100.${++ipCounter}`;

function makeReq(method: string, path: string, opts: RequestOptions): IncomingMessage {
  const body =
    opts.raw ??
    (opts.form
      ? new URLSearchParams(opts.form).toString()
      : opts.json !== undefined
        ? JSON.stringify(opts.json)
        : "");
  const req = Readable.from(body ? [Buffer.from(body, "utf8")] : []) as Readable & Partial<IncomingMessage>;
  req.method = method;
  req.url = path;
  // The peer address, not the header, is the rate-limit identity: X-Forwarded-For is only
  // consulted when MCP_TRUSTED_PROXIES says a proxy we own is in front, and it is unset here.
  // Both are set to the same value so a test cannot accidentally depend on which one is read.
  const ip = opts.ip ?? nextIp();
  req.headers = {
    "content-length": String(Buffer.byteLength(body, "utf8")),
    "x-forwarded-for": ip,
    ...opts.headers,
  };
  req.socket = { remoteAddress: ip } as unknown as IncomingMessage["socket"];
  return req as unknown as IncomingMessage;
}

async function request(method: string, path: string, opts: RequestOptions = {}) {
  const res = new FakeRes();
  // server.ts sets CORS on every response before delegating; the consent page relies on
  // handleOAuth stripping those headers back off, which only shows up if we mirror that.
  setCors(res as unknown as ServerResponse);
  const handled = await handleOAuth(makeReq(method, path, opts), res as unknown as ServerResponse, BASE, API);
  return { res, handled };
}

// ─── Stubbed platform ─────────────────────────────────────────────────────────

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (ttlSeconds: number) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "buyer@demo.com", exp: Math.floor(Date.now() / 1000) + ttlSeconds })}.sig`;

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const failed = (status: number) => ({ ok: false, status, json: async () => ({ message: "nope" }) });

let platformRefresh: string;
let rotations: number;
let loginAccessToken: string;
let refreshAccessToken: string;

function makeFetchMock() {
  return vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = JSON.parse(init?.body ?? "{}") as { email?: string; password?: string; refreshToken?: string };

    if (url === `${API}/auth/login`) {
      if (body.email !== BUYER.email || body.password !== BUYER.password) return failed(401);
      return okJson({ accessToken: loginAccessToken, refreshToken: platformRefresh });
    }
    if (url === `${API}/auth/refresh`) {
      // The real platform rotates refresh tokens too, so replaying a stale one fails. Modelling
      // that is what lets a test tell WHICH token the MCP server forwarded.
      if (body.refreshToken !== platformRefresh) return failed(401);
      platformRefresh = `${PLATFORM_REFRESH}-rotated-${++rotations}`;
      return okJson({ accessToken: refreshAccessToken, refreshToken: platformRefresh });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

let fetchMock: ReturnType<typeof makeFetchMock>;

type FetchCall = [input: unknown, init?: { body?: string }];
const fetchCalls = () => fetchMock.mock.calls as FetchCall[];

const callsTo = (suffix: string) => fetchCalls().filter((call) => String(call[0]).endsWith(suffix)).length;

function lastBodyTo(suffix: string): Record<string, any> {
  const call = [...fetchCalls()].reverse().find((c) => String(c[0]).endsWith(suffix));
  if (!call) throw new Error(`no request was made to ${suffix}`);
  return JSON.parse(String(call[1]?.body ?? "{}"));
}

/** Date.now only — faking timers would also fake the stream internals readBody iterates. */
function freezeClock(): (ms: number) => void {
  const start = Date.now();
  let offset = 0;
  vi.spyOn(Date, "now").mockImplementation(() => start + offset);
  return (ms: number) => {
    offset += ms;
  };
}

beforeEach(() => {
  platformRefresh = PLATFORM_REFRESH;
  rotations = 0;
  loginAccessToken = jwt(3600);
  refreshAccessToken = jwt(7200);
  fetchMock = makeFetchMock();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Flow helpers ─────────────────────────────────────────────────────────────

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function newClient(redirectUris: string[] = [REDIRECT], clientName = "Claude Desktop"): Promise<string> {
  const { res } = await request("POST", "/register", { json: { client_name: clientName, redirect_uris: redirectUris } });
  expect(res.statusCode).toBe(201);
  return res.json<{ client_id: string }>().client_id;
}

async function authorizeToCode(clientId: string, challenge: string, redirectUri = REDIRECT): Promise<string> {
  const { res } = await request("POST", "/authorize", {
    form: {
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "opaque-state",
      ...BUYER,
    },
  });
  expect(res.statusCode).toBe(302);
  const code = new URL(res.headers.location).searchParams.get("code");
  expect(code).toBeTruthy();
  return code as string;
}

const exchangeCode = (clientId: string, code: string, verifier: string, redirectUri = REDIRECT) =>
  request("POST", "/token", {
    form: { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier },
  });

const refreshWith = (clientId: string, refreshToken: string) =>
  request("POST", "/token", { form: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId } });

const revokeWith = (clientId: string, token: string) => request("POST", "/revoke", { form: { token, client_id: clientId } });

interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

/** Register → log in → redeem the code: the whole flow an MCP client runs on first connect. */
async function connect(): Promise<{ clientId: string; res: FakeRes; tokens: Tokens }> {
  const clientId = await newClient();
  const { verifier, challenge } = pkce();
  const code = await authorizeToCode(clientId, challenge);
  const { res } = await exchangeCode(clientId, code, verifier);
  expect(res.statusCode).toBe(200);
  return { clientId, res, tokens: res.json<Tokens>() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("the platform refresh token never leaves the process", () => {
  it("returns an opaque MCP refresh token, with the platform's nowhere in the body", async () => {
    const { res, tokens } = await connect();

    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.refresh_token).not.toBe(PLATFORM_REFRESH);
    expect(res.body).not.toContain(PLATFORM_REFRESH);
  });

  it("keeps it out of the rotation response too", async () => {
    const { clientId, tokens } = await connect();

    const { res } = await refreshWith(clientId, tokens.refresh_token);

    expect(res.statusCode).toBe(200);
    // The stub's rotated token is `${PLATFORM_REFRESH}-rotated-1`, so this covers both.
    expect(res.body).not.toContain(PLATFORM_REFRESH);
  });

  it("forwards the stored platform token to /auth/refresh, not the client's token", async () => {
    const { clientId, tokens } = await connect();

    await refreshWith(clientId, tokens.refresh_token);

    expect(lastBodyTo("/auth/refresh").refreshToken).toBe(PLATFORM_REFRESH);
  });

  it("stores the platform token that /auth/refresh returned, so the next rotation uses it", async () => {
    const { clientId, tokens } = await connect();
    const rotated = (await refreshWith(clientId, tokens.refresh_token)).res.json<Tokens>().refresh_token;

    const second = await refreshWith(clientId, rotated);

    expect(second.res.statusCode).toBe(200);
    expect(lastBodyTo("/auth/refresh").refreshToken).toBe(`${PLATFORM_REFRESH}-rotated-1`);
  });

  it("rejects a caller that presents the raw platform refresh token", async () => {
    const { clientId } = await connect();

    const { res } = await refreshWith(clientId, PLATFORM_REFRESH);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_grant");
    expect(callsTo("/auth/refresh")).toBe(0);
  });

  it("still forwards the platform access token unchanged — that part is deliberate", async () => {
    const { tokens } = await connect();

    expect(tokens.access_token).toBe(loginAccessToken);
    expect(tokens.token_type).toBe("Bearer");
  });
});

describe("refresh token rotation", () => {
  it("hands back a different token each time, carrying the newly minted access token", async () => {
    const { clientId, tokens } = await connect();

    const first = await refreshWith(clientId, tokens.refresh_token);
    const rotated = first.res.json<Tokens>();

    expect(first.res.statusCode).toBe(200);
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    // Not the login token echoed back: the client must get what /auth/refresh just issued.
    expect(rotated.access_token).toBe(refreshAccessToken);
    expect(refreshAccessToken).not.toBe(loginAccessToken);

    const second = await refreshWith(clientId, rotated.refresh_token);
    expect(second.res.statusCode).toBe(200);
    expect(second.res.json<Tokens>().refresh_token).not.toBe(rotated.refresh_token);
  });

  it("destroys the whole family when a consumed token is replayed", async () => {
    const { clientId, tokens } = await connect();
    const rotated = (await refreshWith(clientId, tokens.refresh_token)).res.json<Tokens>().refresh_token;

    const replay = await refreshWith(clientId, tokens.refresh_token);
    expect(replay.res.statusCode).toBe(400);
    expect(replay.res.json().error).toBe("invalid_grant");

    // The live token is collateral damage on purpose: after a leak, nobody keeps the grant.
    const afterReplay = await refreshWith(clientId, rotated);
    expect(afterReplay.res.statusCode).toBe(400);
    expect(callsTo("/auth/refresh")).toBe(1);
  });

  it("lets only one of two overlapping presentations through, spending the platform token once", async () => {
    const { clientId, tokens } = await connect();

    // Both requests are past readBody and into the checks before either has heard back from the
    // platform, so the only thing that can separate them is the token being burnt synchronously,
    // before the await. Consume it afterwards instead and both spend the same platform token.
    const [a, b] = await Promise.all([
      refreshWith(clientId, tokens.refresh_token),
      refreshWith(clientId, tokens.refresh_token),
    ]);

    // Which one wins the race is not ours to pin down; that exactly one wins is.
    expect([a.res.statusCode, b.res.statusCode].sort()).toEqual([200, 400]);
    const loser = a.res.statusCode === 400 ? a : b;
    expect(loser.res.json().error).toBe("invalid_grant");
    expect(callsTo("/auth/refresh")).toBe(1);
  });

  it("drops the grant when the platform rejects the stored token", async () => {
    const { clientId, tokens } = await connect();
    platformRefresh = "rotated-out-from-under-us";

    const failedRefresh = await refreshWith(clientId, tokens.refresh_token);
    expect(failedRefresh.res.statusCode).toBe(400);

    // Same token again: if the grant had survived it would reach the platform a second time.
    const retry = await refreshWith(clientId, tokens.refresh_token);
    expect(retry.res.statusCode).toBe(400);
    expect(callsTo("/auth/refresh")).toBe(1);
  });
});

describe("MCP refresh tokens at rest", () => {
  /**
   * The only case that reaches inside the module, and deliberately so: hashing is applied
   * symmetrically on write and on read, so removing it leaves every response, status code and
   * lookup identical. Nothing observable from the outside can tell the two apart — the stored
   * shape is the whole control.
   */
  it("are held only as SHA-256 digests, so a heap dump has nothing replayable in it", async () => {
    const { clientId, tokens } = await connect();
    const rotated = (await refreshWith(clientId, tokens.refresh_token)).res.json<Tokens>().refresh_token;

    const { refreshIndexKeys, grantTokenHashes } = __tokenStoreSnapshotForTests();
    const stored = [...refreshIndexKeys, ...grantTokenHashes];

    // Every stored key is a digest — including the ones this suite's earlier cases left behind,
    // since a single unhashed write anywhere is a live credential sitting in memory.
    expect(stored.length).toBeGreaterThan(0);
    for (const key of stored) expect(key).toMatch(/^[0-9a-f]{64}$/);

    // The spent token stays indexed (that is how reuse is detected), so both of these are in
    // there right now — as digests, and not as the strings the client was handed.
    for (const issued of [tokens.refresh_token, rotated]) {
      const digest = createHash("sha256").update(issued).digest("hex");
      expect(refreshIndexKeys).toContain(digest);
      expect(grantTokenHashes).toContain(digest);
      expect(stored).not.toContain(issued);
    }
  });
});

describe("client binding", () => {
  it("refuses to let another registered client refresh someone else's grant", async () => {
    const victim = await connect();
    const attacker = await newClient(["https://attacker.example/cb"], "Totally Legit App");

    const stolen = await refreshWith(attacker, victim.tokens.refresh_token);

    expect(stolen.res.statusCode).toBe(400);
    expect(stolen.res.json().error).toBe("invalid_grant");
    expect(callsTo("/auth/refresh")).toBe(0);
  });

  it("treats a wrong client_id as a misconfiguration, so the real client still works", async () => {
    const victim = await connect();
    const other = await newClient(["https://other.example/cb"]);

    await refreshWith(other, victim.tokens.refresh_token);
    const legitimate = await refreshWith(victim.clientId, victim.tokens.refresh_token);

    expect(legitimate.res.statusCode).toBe(200);
  });

  it("rejects a refresh with no client_id at all", async () => {
    const { tokens } = await connect();

    const { res } = await request("POST", "/token", {
      form: { grant_type: "refresh_token", refresh_token: tokens.refresh_token },
    });

    expect(res.statusCode).toBe(400);
    expect(callsTo("/auth/refresh")).toBe(0);
  });
});

describe("authorization codes", () => {
  it("are single use", async () => {
    const clientId = await newClient();
    const { verifier, challenge } = pkce();
    const code = await authorizeToCode(clientId, challenge);

    expect((await exchangeCode(clientId, code, verifier)).res.statusCode).toBe(200);

    const replay = await exchangeCode(clientId, code, verifier);
    expect(replay.res.statusCode).toBe(400);
    expect(replay.res.json().error).toBe("invalid_grant");
  });

  it("are bound to the PKCE verifier, and a wrong verifier burns the code", async () => {
    const clientId = await newClient();
    const { verifier, challenge } = pkce();
    const code = await authorizeToCode(clientId, challenge);

    const guessed = await exchangeCode(clientId, code, pkce().verifier);
    expect(guessed.res.statusCode).toBe(400);

    // An interceptor who guesses once must not leave a code the real client can still redeem.
    const genuine = await exchangeCode(clientId, code, verifier);
    expect(genuine.res.statusCode).toBe(400);
  });

  it("are bound to the redirect_uri they were issued for", async () => {
    const second = "https://client.example/other";
    const clientId = await newClient([REDIRECT, second]);
    const { verifier, challenge } = pkce();
    const code = await authorizeToCode(clientId, challenge, REDIRECT);

    // Both URIs are registered, so only the code↔redirect_uri binding can reject this.
    const { res } = await exchangeCode(clientId, code, verifier, second);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_grant");
  });

  it("cannot be redeemed by a different registered client", async () => {
    const clientId = await newClient();
    const other = await newClient(["https://other.example/cb"]);
    const { verifier, challenge } = pkce();
    const code = await authorizeToCode(clientId, challenge);

    const { res } = await exchangeCode(other, code, verifier);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_grant");
  });

  it("are not minted when the platform rejects the password", async () => {
    const clientId = await newClient();
    const { challenge } = pkce();

    const { res } = await request("POST", "/authorize", {
      form: {
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        email: BUYER.email,
        password: "wrong-password",
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers.location).toBeUndefined();
  });

  it("are not minted for a POST that skips PKCE, even though the GET checked it", async () => {
    const clientId = await newClient();

    const { res } = await request("POST", "/authorize", {
      form: { client_id: clientId, redirect_uri: REDIRECT, ...BUYER },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    // Credentials must not reach the platform before the request is known to be well formed.
    expect(callsTo("/auth/login")).toBe(0);
  });

  it("are not minted for an unregistered redirect_uri", async () => {
    const clientId = await newClient();
    const { challenge } = pkce();

    const { res } = await request("POST", "/authorize", {
      form: {
        client_id: clientId,
        redirect_uri: "https://attacker.example/cb",
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...BUYER,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(callsTo("/auth/login")).toBe(0);
  });
});

describe("revocation", () => {
  it("makes a later refresh fail", async () => {
    const { clientId, tokens } = await connect();

    const revoke = await revokeWith(clientId, tokens.refresh_token);
    expect(revoke.res.statusCode).toBe(200);

    const { res } = await refreshWith(clientId, tokens.refresh_token);
    expect(res.statusCode).toBe(400);
    expect(callsTo("/auth/refresh")).toBe(0);
  });

  it("kills the whole family, not just the token presented", async () => {
    const { clientId, tokens } = await connect();
    const rotated = (await refreshWith(clientId, tokens.refresh_token)).res.json<Tokens>().refresh_token;

    // Revoke the already-spent token: only destroying the grant behind it can reach the live one.
    await revokeWith(clientId, tokens.refresh_token);

    const { res } = await refreshWith(clientId, rotated);
    expect(res.statusCode).toBe(400);
    expect(callsTo("/auth/refresh")).toBe(1);
  });

  it("ignores a revocation from a different client", async () => {
    const { clientId, tokens } = await connect();
    const other = await newClient(["https://other.example/cb"]);

    const revoke = await revokeWith(other, tokens.refresh_token);
    expect(revoke.res.statusCode).toBe(200); // RFC 7009: no oracle, even when nothing happened

    const { res } = await refreshWith(clientId, tokens.refresh_token);
    expect(res.statusCode).toBe(200);
  });

  it("answers 200 for a token it has never seen", async () => {
    const { res } = await revokeWith("nobody", "never-issued");

    expect(res.statusCode).toBe(200);
  });
});

describe("expires_in", () => {
  it("comes from the access token's own exp claim, not a constant", async () => {
    loginAccessToken = jwt(3600);

    const { tokens } = await connect();

    expect(tokens.expires_in).toBeGreaterThan(3590);
    expect(tokens.expires_in).toBeLessThanOrEqual(3600);
  });

  it("tracks the exp of the token minted by a refresh", async () => {
    const { clientId, tokens } = await connect();
    refreshAccessToken = jwt(7200);

    const { res } = await refreshWith(clientId, tokens.refresh_token);

    expect(res.json<Tokens>().expires_in).toBeGreaterThan(7190);
    expect(res.json<Tokens>().expires_in).toBeLessThanOrEqual(7200);
  });

  it("falls back to the platform's configured TTL when the token is not a JWT", async () => {
    loginAccessToken = "opaque-token-with-no-claims";

    const { tokens } = await connect();

    expect(tokens.expires_in).toBe(ACCESS_TOKEN_TTL_FALLBACK_S);
  });

  it("falls back rather than repeating an implausible exp", async () => {
    loginAccessToken = jwt(72 * 60 * 60); // beyond the 24h clamp

    const { tokens } = await connect();

    expect(tokens.expires_in).toBe(ACCESS_TOKEN_TTL_FALLBACK_S);
  });
});

describe("registration", () => {
  it("rejects a JSON body that is not an object", async () => {
    for (const raw of ["null", "42", "[]", '"hi"']) {
      const { res, handled } = await request("POST", "/register", { raw });
      expect(handled).toBe(true);
      expect(res.statusCode, raw).toBe(400); // a 500 here means it threw past the route
    }
  });

  it("rejects a redirect_uri that is neither https nor loopback http", async () => {
    for (const uri of ["http://evil.example/cb", "javascript:alert(1)", "https://x.example/cb#frag", "https://u:p@x.example/cb"]) {
      const { res } = await request("POST", "/register", { json: { redirect_uris: [uri] } });
      expect(res.statusCode, uri).toBe(400);
      expect(res.json().error).toBe("invalid_redirect_uri");
    }
  });

  it("accepts loopback http for native clients", async () => {
    const { res } = await request("POST", "/register", { json: { redirect_uris: ["http://127.0.0.1:6274/callback"] } });

    expect(res.statusCode).toBe(201);
  });

  it("rejects a client_name that is not a string", async () => {
    const { res } = await request("POST", "/register", { json: { redirect_uris: [REDIRECT], client_name: 42 } });

    expect(res.statusCode).toBe(400);
  });

  it("rejects an empty or oversized redirect_uris list", async () => {
    const many = Array.from({ length: 6 }, (_, i) => `https://client.example/cb${i}`);

    expect((await request("POST", "/register", { json: { redirect_uris: [] } })).res.statusCode).toBe(400);
    expect((await request("POST", "/register", { json: { redirect_uris: many } })).res.statusCode).toBe(400);
  });
});

describe("the token endpoint", () => {
  it("rejects an unknown grant_type instead of guessing", async () => {
    const { res } = await request("POST", "/token", { form: { grant_type: "password", ...BUYER } });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unsupported_grant_type");
    expect(callsTo("/auth/login")).toBe(0);
  });

  it("never caches a token response", async () => {
    const { res } = await connect();

    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("request handling", () => {
  it("hands non-OAuth paths to the MCP transport untouched", async () => {
    const { res, handled } = await request("POST", "/mcp", { raw: "{}" });

    expect(handled).toBe(false);
    expect(res.statusCode).toBe(0);
    expect(res.body).toBe("");
  });

  it("answers metadata only on the exact well-known paths", async () => {
    const exact = await request("GET", "/.well-known/oauth-authorization-server");
    expect(exact.handled).toBe(true);
    expect(exact.res.json().revocation_endpoint).toBe(`${BASE}/revoke`);

    // startsWith used to answer here, and on every path below it.
    expect((await request("GET", "/.well-known/oauth-authorization-serverANYTHING")).handled).toBe(false);
    expect((await request("GET", "/.well-known/oauth-authorization-server/extra")).handled).toBe(false);
  });

  it("advertises the protected resource for a 401'd MCP client", async () => {
    const { res } = await request("GET", "/.well-known/oauth-protected-resource");

    expect(res.statusCode).toBe(200);
    expect(res.json().authorization_servers).toEqual([BASE]);
  });

  it("caps the request body, even when content-length lies", async () => {
    const oversized = "x".repeat(20 * 1024);

    const declared = await request("POST", "/register", { raw: oversized });
    expect(declared.res.statusCode).toBe(413);

    const lying = await request("POST", "/register", { raw: oversized, headers: { "content-length": "10" } });
    expect(lying.res.statusCode).toBe(413);
  });
});

describe("the consent page", () => {
  const consentPage = async (clientId: string) => {
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
    });
    return request("GET", `/authorize?${query}`);
  };

  it("escapes the attacker-chosen client name", async () => {
    const clientId = await newClient([REDIRECT], "<script>alert(1)</script>");

    const { res } = await consentPage(clientId);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<script>");
    expect(res.body).toContain("&#60;script&#62;");
  });

  it("tells the buyer the name is unverified and where they will be sent", async () => {
    const clientId = await newClient([REDIRECT], "Nanas Kitchens Official");

    const { res } = await consentPage(clientId);

    expect(res.body).toContain("Unverified");
    expect(res.body).toContain("client.example");
  });

  it("cannot be read cross-origin or framed", async () => {
    const clientId = await newClient();

    const { res } = await consentPage(clientId);

    // setCors() ran first, as it does in server.ts — the page has to strip it back off.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("refuses to render for an unknown client", async () => {
    const { res } = await consentPage("0".repeat(32));

    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("<form");
  });
});

describe("rate limiting", () => {
  it("stops using the platform as a brute-force oracle", async () => {
    const ip = "203.0.113.7";
    const clientId = await newClient();
    const attempt = () =>
      request("POST", "/authorize", {
        ip,
        form: {
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: pkce().challenge,
          code_challenge_method: "S256",
          email: BUYER.email,
          password: "guess",
        },
      });

    for (let i = 0; i < 20; i += 1) expect((await attempt()).res.statusCode).toBe(401);

    const blocked = await attempt();
    expect(blocked.res.statusCode).toBe(429);
    expect(callsTo("/auth/login")).toBe(20);
  });
});

describe("the rate-limit key behind a proxy", () => {
  /**
   * makeReq sets the header and the peer address to the same value on purpose, which is the one
   * thing a test of this control cannot use. This variant drives them apart: `chain` is the
   * X-Forwarded-For the caller (plus whatever proxies are in front) composed, `socketIp` is the
   * peer address the kernel reports. opts.headers is spread last, so it replaces the pair makeReq
   * set — the same door the body-cap case above goes through for content-length.
   */
  const registerFromProxy = (chain: string, socketIp: string) =>
    request("POST", "/register", {
      ip: socketIp,
      headers: { "x-forwarded-for": chain },
      json: { redirect_uris: [REDIRECT] },
    });

  /** Mirrors REGISTER_RATE.max — deliberately duplicated so a silent drift fails here. */
  const REGISTER_MAX = 20;

  /**
   * Each row names the element that MUST become the key for that many trusted hops. `build` puts
   * it where the module should be looking and fills the rest of the request with text that moves
   * on every call, so a bucket that fills up can only have been keyed on the constant.
   */
  const hops: {
    what: string;
    trustedProxies: string;
    keyedOn: string;
    build: (keyed: string, noise: number) => { chain: string; socketIp: string };
  }[] = [
    {
      what: "0 — no proxy in front, so the header is ignored outright",
      trustedProxies: "0",
      keyedOn: "203.0.113.20",
      build: (keyed, noise) => ({ chain: `1.1.1.${noise}, 2.2.2.${noise}, 3.3.3.${noise}`, socketIp: keyed }),
    },
    {
      what: "1 — the last element, the only one the planned ALB could have appended",
      trustedProxies: "1",
      keyedOn: "3.3.3.3",
      build: (keyed, noise) => ({ chain: `1.1.1.${noise}, 2.2.2.${noise}, ${keyed}`, socketIp: `192.0.2.${noise}` }),
    },
    {
      what: "2 — one element further left, past the second hop we also own",
      trustedProxies: "2",
      keyedOn: "2.2.2.2",
      build: (keyed, noise) => ({ chain: `1.1.1.${noise}, ${keyed}, 3.3.3.${noise}`, socketIp: `192.0.2.${noise}` }),
    },
    {
      what: "2, but a shorter chain — nobody spoofed anything, so the peer address stands",
      trustedProxies: "2",
      keyedOn: "203.0.113.21",
      build: (keyed, noise) => ({ chain: `3.3.3.${noise}`, socketIp: keyed }),
    },
  ];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is the hop MCP_TRUSTED_PROXIES counts back to, so the text around it cannot buy a fresh budget", async () => {
    for (const { what, trustedProxies, keyedOn, build } of hops) {
      vi.stubEnv("MCP_TRUSTED_PROXIES", trustedProxies);

      // Everything but that one element differs on every request — the elements to its left, the
      // ones to its right, and (where the header is trusted at all) the peer address too. Reading
      // the chain from the wrong end gives each of these its own budget and none of them is ever
      // refused; only counting back from the right lands them all in one bucket.
      for (let n = 1; n <= REGISTER_MAX; n += 1) {
        const { chain, socketIp } = build(keyedOn, n);
        expect((await registerFromProxy(chain, socketIp)).res.statusCode, `${what} (#${n})`).toBe(201);
      }

      const spent = build(keyedOn, REGISTER_MAX + 1);
      const blocked = await registerFromProxy(spent.chain, spent.socketIp);
      expect(blocked.res.statusCode, what).toBe(429);
      expect(blocked.res.json().error_description).toBe("Too many registrations");
    }
  });

  it("moves with that hop, so a genuinely different caller still gets a budget of its own", async () => {
    for (const [row, { what, trustedProxies, build }] of hops.entries()) {
      vi.stubEnv("MCP_TRUSTED_PROXIES", trustedProxies);

      // The mirror image: the noise is held still and the keyed element is what moves. Every one
      // of these is a different caller, so past the limit or not, none of them may be refused.
      for (let n = 1; n <= REGISTER_MAX + 1; n += 1) {
        const { chain, socketIp } = build(`10.0.${row}.${n}`, 0);
        expect((await registerFromProxy(chain, socketIp)).res.statusCode, `${what} (caller ${n})`).toBe(201);
      }
    }
  });
});

describe("expiry (these shift Date.now, so they run last)", () => {
  it("expires an authorization code after five minutes", async () => {
    const advance = freezeClock();
    const clientId = await newClient();
    const early = pkce();
    const late = pkce();
    const earlyCode = await authorizeToCode(clientId, early.challenge);
    const lateCode = await authorizeToCode(clientId, late.challenge);

    advance(4 * 60 * 1000);
    expect((await exchangeCode(clientId, earlyCode, early.verifier)).res.statusCode).toBe(200);

    advance(2 * 60 * 1000); // six minutes old
    const expired = await exchangeCode(clientId, lateCode, late.verifier);
    expect(expired.res.statusCode).toBe(400);
    expect(expired.res.json().error).toBe("invalid_grant");
  });

  // Three mechanisms enforce this from the outside and the grant and client TTLs are both 30
  // days, so no black-box test can say which one fired; what it does pin is that a stored
  // platform credential cannot outlive the window and still be spent.
  it("stops honouring an authorization left idle past the 30-day window", async () => {
    const advance = freezeClock();
    const { clientId, tokens } = await connect();

    advance(31 * 24 * 60 * 60 * 1000);
    const { res } = await refreshWith(clientId, tokens.refresh_token);

    expect(res.statusCode).toBe(400);
    expect(callsTo("/auth/refresh")).toBe(0);
  });
});
