"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

type CareerGoal = {
  id: string;
  title: string;
  target_level: string | null;
  target_function: string | null;
  status: string;
  primary_resume_id: string | null;
  created_at: string;
  updated_at: string;
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function GoalDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [goal, setGoal] = useState<CareerGoal | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "not_found" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/goals/${id}`);

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        if (res.status === 404) {
          if (!cancelled) setStatus("not_found");
          return;
        }

        const json = await res.json();

        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setError(json?.error || "Failed to load career goal");
          setStatus("error");
          return;
        }

        setGoal(json.data as CareerGoal);
        setStatus("ok");
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load career goal");
        setStatus("error");
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return (
    <>
      <div className="space-y-1">
        <Link
          href="/dashboard/goals"
          className="text-sm text-gray-500 hover:text-black"
        >
          ← Back to Career Goals
        </Link>
      </div>

      {status === "loading" && (
        <div className="text-sm text-gray-500">Loading career goal…</div>
      )}

      {status === "not_found" && (
        <section className="border border-dashed rounded p-8 bg-white text-center space-y-3">
          <h2 className="font-semibold text-lg">Career goal not found</h2>
          <p className="text-sm text-gray-600">
            It may have been deleted, or the link is incorrect.
          </p>
          <Link
            href="/dashboard/goals"
            className="inline-block px-4 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800"
          >
            Back to Career Goals
          </Link>
        </section>
      )}

      {status === "error" && (
        <div className="border border-red-200 bg-red-50 text-red-800 rounded p-4 text-sm">
          {error}
        </div>
      )}

      {status === "ok" && goal && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold">{goal.title}</h1>
              <p className="text-sm text-gray-500">
                Created {new Date(goal.created_at).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap ${
                goal.status === "active"
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {goal.status}
            </span>
          </div>

          <section className="border rounded p-5 bg-white shadow-sm">
            <h2 className="font-semibold text-lg mb-3">Goal details</h2>
            <div className="text-sm text-gray-700 space-y-2">
              <div>
                <span className="text-gray-500">Target level:</span>{" "}
                <span className="font-medium">
                  {goal.target_level || "Not set"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Target function:</span>{" "}
                <span className="font-medium">
                  {goal.target_function || "Not set"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>{" "}
                <span className="font-medium">{goal.status}</span>
              </div>
            </div>
          </section>

          <section className="border rounded p-5 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2 className="font-semibold text-lg">Target roles</h2>
            </div>

            <div className="border border-dashed rounded p-6 bg-gray-50 text-center space-y-1">
              <p className="text-sm text-gray-700 font-medium">
                No target roles yet.
              </p>
              <p className="text-sm text-gray-600">
                Add 2–5 roles to identify patterns across your target market.
              </p>
            </div>
          </section>
        </>
      )}
    </>
  );
}
