import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, apiFetch, getAccessToken } from "./api";

/**
 * Refresh tokens are single-use and rotated by the server. Two requests that both get a 401
 * at the same time must therefore share ONE refresh call: the old code fired two, the second
 * presented an already-spent token, got a non-ok response and ran clearTokens() — wiping the
 * fresh tokens the first call had just saved and logging the user out for no reason.
 *
 * The assertion that bites is the CALL COUNT on /auth/refresh. Both requests end up 200 even
 * in the broken version (the retry happens before the loser clears), so a test that only
 * checks the responses would stay green through the bug.
 */

interface Server {
  refreshCalls: number;
  resolveRefresh: () => void;
}

/** Installs a fetch stub whose /auth/refresh is single-use and deliberately slow. */
function installServer(): Server {
  const state = {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    refreshCalls: 0,
    releaseRefresh: () => {},
  };
  const refreshGate = new Promise<void>((resolve) => {
    state.releaseRefresh = resolve;
  });

  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === `${API}/auth/refresh`) {
      state.refreshCalls += 1;
      const presented = JSON.parse(String(init?.body ?? "{}")).refreshToken;
      // Hold every refresh open until the test releases it, so both callers are genuinely
      // in flight at the same time rather than accidentally serialised.
      await refreshGate;
      if (presented !== state.refreshToken) {
        return new Response(JSON.stringify({ message: "INVALID_REFRESH" }), { status: 400 });
      }
      state.accessToken = "access-2";
      state.refreshToken = "refresh-2";
      return new Response(
        JSON.stringify({ accessToken: state.accessToken, refreshToken: state.refreshToken }),
        { status: 200 },
      );
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    const ok = auth === `Bearer ${state.accessToken}`;
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 401 });
  });

  return {
    get refreshCalls() {
      return state.refreshCalls;
    },
    resolveRefresh: () => state.releaseRefresh(),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("apiFetch token refresh", () => {
  it("refreshes once for concurrent 401s and keeps the new tokens", async () => {
    localStorage.setItem("access_token", "stale");
    localStorage.setItem("refresh_token", "refresh-1");
    const server = installServer();

    const both = Promise.all([apiFetch("/orders"), apiFetch("/kitchens/mine")]);
    // Both requests are now parked on the shared refresh; let it complete.
    await Promise.resolve();
    server.resolveRefresh();
    const [a, b] = await both;

    expect(server.refreshCalls).toBe(1);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(getAccessToken()).toBe("access-2");
    expect(localStorage.getItem("refresh_token")).toBe("refresh-2");
  });

  it("clears the tokens when the refresh genuinely fails", async () => {
    localStorage.setItem("access_token", "stale");
    localStorage.setItem("refresh_token", "not-the-current-one");
    const server = installServer();

    const res = apiFetch("/orders");
    server.resolveRefresh();

    expect((await res).status).toBe(401);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
  });

  it("starts a fresh refresh for a later 401 rather than reusing the finished one", async () => {
    localStorage.setItem("access_token", "stale");
    localStorage.setItem("refresh_token", "refresh-1");
    const server = installServer();

    const first = apiFetch("/orders");
    server.resolveRefresh();
    expect((await first).status).toBe(200);
    expect(server.refreshCalls).toBe(1);

    // A token that expires again later must not be blocked by the settled in-flight promise.
    localStorage.setItem("access_token", "stale-again");
    expect((await apiFetch("/orders")).status).toBe(200);
    expect(server.refreshCalls).toBe(2);
  });
});
