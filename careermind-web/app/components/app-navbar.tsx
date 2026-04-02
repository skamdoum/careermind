"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

export default function AppNavbar() {
  const pathname = usePathname();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState<string>("");

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.email) {
        setUserEmail(user.email);
      } else if (user?.id) {
        setUserEmail(`${user.id.slice(0, 8)}...`);
      }
    }

    loadUser();
  }, [supabase]);

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

      <div className="flex items-center gap-3">
        {userEmail && (
        <div className="text-sm text-gray-600 hidden sm:block">
        Signed in as <span className="font-medium text-black">{userEmail}</span>
        </div>
        )}

        <button
          onClick={handleSignOut}
          className="px-3 py-2 rounded text-sm font-medium border hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}