/**
 * API client + token management (Phase 1 / auth).
 * Tokens live in localStorage — "access_token" matches what the chat page already reads.
 * apiFetch() attaches the bearer token and transparently retries once after a refresh
 * when the API answers 401 (access tokens expire after 8 hours — app.jwt.access-token-ttl-minutes).
 */
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

export interface Session {
  userId: string;
  role: "buyer" | "seller" | "inspector" | "admin";
}

export function saveTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  window.dispatchEvent(new Event("session-changed"));
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  window.dispatchEvent(new Event("session-changed"));
}

export function getAccessToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(ACCESS_KEY);
}

/** Decodes the JWT payload client-side (display/routing only — the API re-verifies). */
export function getSession(): Session | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp * 1000 < Date.now()) return null;
    return { userId: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

/** Like getSession(), but attempts a silent refresh first when the access token has expired
 * locally — page guards call this so an expired-but-refreshable session doesn't bounce the
 * user to /login for no reason (getSession() alone only checks the local exp claim). */
export async function ensureSession(): Promise<Session | null> {
  const s = getSession();
  if (s) return s;
  if (await tryRefresh()) return getSession();
  return null;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = typeof window === "undefined" ? null : localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  const res = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    clearTokens();
    return false;
  }
  const body = await res.json();
  saveTokens(body.accessToken, body.refreshToken);
  return true;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // FormData bodies must let the browser set the multipart boundary header itself.
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const doFetch = () =>
    fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(isForm ? {} : { "content-type": "application/json" }),
        ...(init.headers ?? {}),
        ...(getAccessToken() ? { authorization: `Bearer ${getAccessToken()}` } : {}),
      },
    });
  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) {
    res = await doFetch();
  }
  return res;
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "LOGIN_FAILED");
  }
  const body = await res.json();
  saveTokens(body.accessToken, body.refreshToken);
  return getSession()!;
}

export async function register(email: string, password: string, role: "buyer" | "seller"): Promise<Session> {
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "REGISTER_FAILED");
  }
  const body = await res.json();
  saveTokens(body.accessToken, body.refreshToken);
  return getSession()!;
}

export function logout() {
  clearTokens();
}
