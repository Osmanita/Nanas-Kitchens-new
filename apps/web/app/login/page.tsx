"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { login } from "../../lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(next && next.startsWith("/") ? next : "/");
    } catch (err) {
      setError(err instanceof Error && err.message === "INVALID_CREDENTIALS"
        ? "Email or password is incorrect."
        : "Could not log in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    padding: "12px 14px",
    margin: "6px 0 16px",
    border: "1px solid var(--line)",
    borderRadius: 12,
    fontSize: 15,
    background: "var(--surface)",
    color: "var(--text)",
  };

  return (
    <main
      style={{ maxWidth: 440, margin: "0 auto", padding: "8vh 20px", position: "relative" }}
    >
      <div className="hero-glow" aria-hidden="true" style={{ opacity: 0.5 }} />
      <div className="fade-up" style={{ textAlign: "center", marginBottom: 24 }}>
        <div className="halo-orb" style={{ margin: "0 auto 18px" }}>
          N
        </div>
        <h1 style={{ fontSize: "clamp(24px, 4vw, 30px)", fontWeight: 700, letterSpacing: "-0.03em", margin: "0 0 6px" }}>
          Welcome <span className="hero-em">back</span>
        </h1>
        <p style={{ color: "var(--text-2)", fontSize: 15, margin: 0 }}>Real food. Made by neighbors.</p>
      </div>

      <div className="shell fade-up" style={{ animationDelay: "90ms" }}>
        <div className="shell-core" style={{ padding: "28px 26px" }}>
          {error && (
            <div
              role="alert"
              style={{
                background: "#fef2f2",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                borderRadius: 12,
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}
          <form onSubmit={onSubmit}>
            <label htmlFor="email" style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 600 }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={fieldStyle}
            />
            <label htmlFor="password" style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 600 }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={fieldStyle}
            />
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Logging in…" : "Log in"}
            </button>
          </form>
          <p style={{ marginTop: 18, fontSize: 14, color: "var(--text-2)", textAlign: "center" }}>
            New here? <Link href="/register">Create an account</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
