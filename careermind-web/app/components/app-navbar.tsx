"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AppNavbar() {
  const pathname = usePathname();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const linkClass = (href: string) =>
    `px-3 py-2 rounded text-sm font-medium transition ${
      pathname === href
        ? "bg-black text-white"
        : "text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <nav className="border rounded-2xl bg-white shadow-sm px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Link href="/" className="font-semibold text-black">
          CareerMind
        </Link>

        <div className="flex items-center gap-2">
          <Link href="/dashboard" className={linkClass("/dashboard")}>
            Dashboard
          </Link>

          <Link href="/analyze" className={linkClass("/analyze")}>
            Analyze
          </Link>
        </div>
      </div>

      <button
        onClick={handleSignOut}
        className="px-3 py-2 rounded text-sm font-medium border hover:bg-gray-50"
      >
        Sign out
      </button>
    </nav>
  );
}