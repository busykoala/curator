"use client";
import { loginDestination } from "@/features/auth/destination";
import { useState } from "react";
import { readJson } from "./http";
export function LoginForm({ destination = "/home" }: { destination?: string }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = new FormData(event.currentTarget);
      await readJson(
        await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: String(data.get("username")),
            password: String(data.get("password")),
          }),
        }),
      );
      location.href = loginDestination(destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="login-form">
      <label>
        <span>Username</span>
        <input name="username" autoComplete="username" required />
      </label>
      <label>
        <span>Password</span>
        <input
          name="password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          required
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
        />
        Show password
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy} className="primary-button">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
