"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { register } from "../../lib/api";

import styles from "../marketplace.module.css";
import Icon from "../components/Icon";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"buyer" | "seller">("buyer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await register(email, password, role);
      router.push(role === "seller" ? "/seller" : "/");
    } catch (err) {
      setError(
        err instanceof Error && err.message === "EMAIL_TAKEN"
          ? "An account with this email already exists."
          : "Could not create the account. Please try again.",
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
        <span className={styles.eyebrow}>Welcome to the neighborhood</span>
        <h1 className={styles.title}>Make yourself at home.</h1>
        <p className={styles.subtitle}>
          Find a home-cooked meal, or share a recipe of your own.
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={onSubmit}>
          <span className={styles.muted}>I’m here to</span>
          <div className="role-toggle" role="group" aria-label="Account type">
            <button
              type="button"
              aria-pressed={role === "buyer"}
              onClick={() => setRole("buyer")}
            >
              Order a meal
            </button>
            <button
              type="button"
              aria-pressed={role === "seller"}
              onClick={() => setRole("seller")}
            >
              Cook &amp; sell
            </button>
          </div>
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
          <label htmlFor="password">
            Password{" "}
            <span className={styles.muted}>(at least 8 characters)</span>
          </label>
          <input
            id="password"
            className="field"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className={styles.authFoot}>
          Already part of the neighborhood? <Link href="/login">Log in</Link>
        </p>
        <Link href="/" className={styles.textLink}>
          Explore kitchens <Icon name="arrow" width={16} />
        </Link>
      </div>
    </main>
  );
}
