"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import ProfileSwitcher from "@/app/components/profile-switcher";

/**
 * Primary top bar. Single row, hairline bottom border, underlined
 * active tab. Reads as the header of the app rather than a widget
 * floating on the page.
 *
 * Run Analysis is intentionally NOT in primary nav — the V1 flow is
 * Goals → Target Role → Analyze. `/analyze` remains reachable as a
 * secondary link from the Goals page.
 */
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

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  const tabClass = (href: string) =>
    "relative py-3 text-[14px] font-medium transition-colors " +
    (isActive(href)
      ? "text-[color:var(--color-text-primary)] after:absolute after:left-0 after:right-0 after:-bottom-px after:h-[2px] after:bg-[color:var(--color-text-primary)]"
      : "text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]");

  return (
    <nav className="border-b border-[color:var(--color-border-subtle)] bg-[color:var(--color-page)]">
      <div className="mx-auto max-w-[72rem] px-6">
        <div className="flex h-14 items-center gap-8">
          <Link
            href="/"
            className="text-[15px] font-semibold tracking-[-0.01em] text-[color:var(--color-text-primary)]"
          >
            CareerMind
          </Link>

          <div className="flex items-center gap-6 flex-1 min-w-0 overflow-x-auto">
            <Link href="/dashboard" className={tabClass("/dashboard")}>
              Overview
            </Link>
            <Link
              href="/dashboard/goals"
              className={tabClass("/dashboard/goals")}
            >
              Goals
            </Link>
            <Link
              href="/dashboard/strategy-v2"
              className={tabClass("/dashboard/strategy-v2")}
            >
              Strategy
            </Link>
            <Link
              href="/dashboard/strategy"
              className={tabClass("/dashboard/strategy")}
            >
              Action Plan
            </Link>
            <Link
              href="/dashboard/history"
              className={tabClass("/dashboard/history")}
            >
              History
            </Link>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            {userEmail && <ProfileSwitcher userEmail={userEmail} />}
            <button
              type="button"
              onClick={handleSignOut}
              className="text-[13px] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
