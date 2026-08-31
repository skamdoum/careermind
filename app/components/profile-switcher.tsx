"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type CareerProfile = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
};

type ProfileSwitcherProps = {
  userEmail: string;
};

export default function ProfileSwitcher({ userEmail }: ProfileSwitcherProps) {
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [listRes, activeRes] = await Promise.all([
          fetch("/api/career-profiles", { cache: "no-store" }),
          fetch("/api/career-profiles/active", { cache: "no-store" }),
        ]);

        const listJson = await listRes.json().catch(() => null);
        const activeJson = await activeRes.json().catch(() => null);

        if (cancelled) return;

        if (listJson?.success) setProfiles(listJson.data as CareerProfile[]);
        if (activeJson?.success) setActiveId(activeJson.data.id as string);
      } catch {
        // Non-fatal — switcher stays inert.
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeProfile = profiles.find((p) => p.id === activeId);

  async function handleSwitch(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch("/api/career-profiles/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error || "Failed to switch profile");
        setSwitching(false);
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError("Failed to switch profile");
      setSwitching(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-1.5 text-[13px] font-medium hover:bg-[color:var(--color-surface-elevated)] flex items-center gap-2 max-w-[220px] disabled:opacity-60"
        disabled={switching}
      >
        <span className="text-[color:var(--color-text-muted)] shrink-0">Direction</span>
        <span className="text-[color:var(--color-text-primary)] truncate">
          {activeProfile?.name || "…"}
        </span>
        <span className="text-[color:var(--color-text-muted)] shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border rounded-lg shadow-lg z-10">
          <div className="p-2 max-h-72 overflow-y-auto">
            {profiles.length === 0 && (
              <div className="text-sm text-gray-500 px-3 py-2">Loading…</div>
            )}
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSwitch(p.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-gray-50 ${
                  p.id === activeId ? "bg-gray-100" : ""
                }`}
                disabled={switching}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  {p.id === activeId && (
                    <span className="text-xs text-gray-500 shrink-0">
                      Active
                    </span>
                  )}
                </div>
                {p.description && (
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {p.description}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="border-t p-2 space-y-1">
            <Link
              href="/dashboard/profiles/new"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 rounded text-sm hover:bg-gray-50"
            >
              + New career profile
            </Link>
            {activeId && (
              <Link
                href={`/dashboard/profiles/${activeId}/edit`}
                onClick={() => setOpen(false)}
                className="block px-3 py-2 rounded text-sm text-gray-600 hover:bg-gray-50"
              >
                Edit current profile
              </Link>
            )}
          </div>

          <div className="border-t px-3 py-2 text-xs text-gray-500">
            <div className="truncate">Signed in as {userEmail}</div>
          </div>

          {error && (
            <div className="border-t px-3 py-2 text-xs text-red-700 bg-red-50">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
