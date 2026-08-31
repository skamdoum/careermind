"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Return a safe internal path from the `next` search param. Only
 * accepts paths that start with a single `/` (excludes `//` and
 * `/\` protocol-relative URLs) to prevent open-redirect abuse.
 */
function safeNextParam(raw: string | null): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

function LoginForm() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const next = safeNextParam(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function handleSignUp() {
    setMessage("Loading…");

    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Account created. Signing you in…");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!signInError) {
      await fetch("/api/profile/ensure", { method: "POST" });
      window.location.href = next;
    }
  }

  async function handleSignIn() {
    setMessage("Loading…");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    await fetch("/api/profile/ensure", { method: "POST" });
    window.location.href = next;
  }

  return (
    <main className="min-h-screen bg-[color:var(--color-page)] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="text-[15px] font-semibold tracking-[-0.01em] text-[color:var(--color-text-primary)]">
            CareerMind
          </div>
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-[color:var(--color-text-primary)]">
            Sign in
          </h1>
          <p className="text-[13px] text-[color:var(--color-text-secondary)]">
            Career decisions for Senior and Principal PMs.
          </p>
        </div>

        <div className="space-y-3">
          <input
            className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <input
            className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[14px] font-medium text-white hover:opacity-90"
            onClick={handleSignIn}
          >
            Sign in
          </button>
          <button
            type="button"
            className="flex-1 rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-4 py-2 text-[14px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            onClick={handleSignUp}
          >
            Create account
          </button>
        </div>

        {message && (
          <div className="text-[13px] text-[color:var(--color-text-secondary)] text-center">
            {message}
          </div>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
