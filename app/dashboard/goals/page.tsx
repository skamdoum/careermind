"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type CareerGoal = {
  id: string;
  title: string;
  target_level: string | null;
  target_function: string | null;
  status: string;
  created_at: string;
};

export default function GoalsListPage() {
  const router = useRouter();
  const [goals, setGoals] = useState<CareerGoal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/goals");

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        const json = await res.json();

        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setError(json?.error || "Failed to load career goals");
          setGoals([]);
          return;
        }

        setGoals(json.data as CareerGoal[]);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load career goals");
        setGoals([]);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const isLoading = goals === null && !error;
  const isEmpty = goals !== null && goals.length === 0 && !error;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Career Goals</h1>
          <p className="text-sm text-gray-500 mt-1">
            The direction you&apos;re targeting. Each goal anchors the jobs and
            analyses you compare against it.
          </p>
        </div>

        {goals && goals.length > 0 && (
          <Link
            href="/dashboard/goals/new"
            className="px-3 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800 whitespace-nowrap"
          >
            New career goal
          </Link>
        )}
      </div>

      {isLoading && (
        <div className="text-sm text-gray-500">Loading career goals…</div>
      )}

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-800 rounded p-4 text-sm">
          {error}
        </div>
      )}

      {isEmpty && (
        <section className="border border-dashed rounded p-8 bg-white text-center space-y-4">
          <div className="space-y-1">
            <h2 className="font-semibold text-lg">No career goals yet</h2>
            <p className="text-sm text-gray-600">
              Set a goal to anchor your analyses against a specific direction —
              level, function, and the roles you&apos;re targeting.
            </p>
          </div>
          <Link
            href="/dashboard/goals/new"
            className="inline-block px-4 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800"
          >
            Create your first career goal
          </Link>
        </section>
      )}

      {goals && goals.length > 0 && (
        <div className="space-y-3">
          {goals.map((g) => (
            <Link
              key={g.id}
              href={`/dashboard/goals/${g.id}`}
              className="block border rounded p-4 hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="font-medium text-base">{g.title}</div>
                <span
                  className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap ${
                    g.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {g.status}
                </span>
              </div>

              <div className="text-sm text-gray-600 mt-1">
                {[g.target_level, g.target_function].filter(Boolean).join(" · ") ||
                  "No target level or function set"}
              </div>

              <div className="text-xs text-gray-500 mt-2">
                Created {new Date(g.created_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
