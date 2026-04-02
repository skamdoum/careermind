"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function handleSignUp() {
  setMessage("Loading...");

  const { error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    setMessage(error.message);
    return;
  }

  setMessage("Account created. Signing you in...");

  // auto sign in after sign up
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (!signInError) {
    await fetch("/api/profile/ensure", { method: "POST" });
    //window.location.href = "/dashboard";
    window.location.href = "/analyze";
  }
}

  async function handleSignIn() {
  setMessage("Loading...");

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    setMessage(error.message);
    return;
  }

  // ensure profile exists
  await fetch("/api/profile/ensure", { method: "POST" });

  // redirect to dashboard
  //window.location.href = "/dashboard";
  window.location.href = "/analyze";
}

  return (
    <main className="max-w-md mx-auto p-6 space-y-4 text-black">
      <h1 className="text-2xl font-bold">Login</h1>

      <input
        className="w-full border rounded p-2"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        className="w-full border rounded p-2"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <div className="flex gap-2">
        <button className="px-4 py-2 bg-black text-white rounded" onClick={handleSignIn}>
          Sign in
        </button>

        <button className="px-4 py-2 border rounded" onClick={handleSignUp}>
          Sign up
        </button>
      </div>

      {message && <div className="text-sm">{message}</div>}
    </main>
  );
}