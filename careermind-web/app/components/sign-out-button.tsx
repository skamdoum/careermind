"use client";

import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <button onClick={handleSignOut} className="px-3 py-2 border rounded">
      Sign out
    </button>
  );
}