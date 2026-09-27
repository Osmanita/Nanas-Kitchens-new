"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { login } from "../../lib/api";

/** A leading "/" is not enough: "//evil.com" and "/\evil.com" are protocol-relative URLs that
 * browsers resolve to another origin, so the post-login redirect would leave the site. Only
 * accept a path whose second character is a normal path character. */
function isSafeNext(next: string | null): next is string {
  return !!next && next.startsWith("/") && next[1] !== "/" && next[1] !== "\\";
}

import styles from "../marketplace.module.css";
import Icon from "../components/Icon";

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
      const session = await login(email, password);
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(isSafeNext(next) ? next : session.role === "seller" ? "/seller" : "/");
    } catch (err) {
      setError(
        err instanceof Error && err.message === "INVALID_CREDENTIALS"
          ? "Email or password is incorrect."
          : "Could not log in. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.auth}>
      <aside className={styles.authVisual}>
        <img
          src="/dishes/sarma.jpg"
          alt="Home-cooked stuffed vegetables, ready to share"
        />
        <div className={styles.authStory}>
          <h2>
            A familiar recipe.
            <br />A new connection.
          </h2>
          <p>
            Good food brings a neighborhood together. There’s a place for you at
            Nana’s table.
          </p>
        </div>
      </aside>
      <div className={styles.authForm}>
        <span className={styles.eyebrow}>Your seat is saved</span>
        <h1 className={styles.title}>Welcome back.</h1>
        <p className={styles.subtitle}>
          Your favorite kitchens are just around the corner.
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={onSubmit}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            className="field"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="field"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className={styles.authFoot}>
          New around here? <Link href="/register">Create an account</Link>
        </p>
        <Link href="/" className={styles.textLink}>
          Explore kitchens <Icon name="arrow" width={16} />
        </Link>
      </div>
    </main>
  );
}
