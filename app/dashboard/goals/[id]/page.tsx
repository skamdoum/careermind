"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

type TargetJob = {
  id: string;
  career_goal_id: string | null;
  company_name: string | null;
  role_title: string | null;
  source_url: string | null;
  jd_text: string;
  status: string;
  created_at: string;
};

type PageProps = {
  params: Promise<{ id: string }>;
};

function jdPreview(text: string, max = 180): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max).trimEnd() + "…";
}

export default function GoalDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const refreshKey = searchParams.get("r") ?? "";

  const [goal, setGoal] = useState<CareerGoal | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "not_found" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<TargetJob[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setGoal(null);
    setStatus("loading");
    setError(null);
    setJobs(null);
    setJobsError(null);

    async function loadGoal() {
      try {
        const res = await fetch(`/api/goals/${id}`, { cache: "no-store" });

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        if (res.status === 404) {
          if (!cancelled) {
            setGoal(null);
            setStatus("not_found");
          }
          return;
        }

        const json = await res.json();
        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setGoal(null);
          setError(json?.error || "Failed to load career goal");
          setStatus("error");
          return;
        }

        setGoal(json.data as CareerGoal);
        setStatus("ok");
      } catch (e: unknown) {
        if (cancelled) return;
        setGoal(null);
        setError(e instanceof Error ? e.message : "Failed to load career goal");
        setStatus("error");
      }
    }

    async function loadJobs() {
      try {
        const res = await fetch(`/api/goals/${id}/jobs`, { cache: "no-store" });

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        if (res.status === 404) {
          if (!cancelled) setJobs([]);
          return;
        }

        const json = await res.json();
        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setJobs([]);
          setJobsError(json?.error || "Failed to load target roles");
          return;
        }

        setJobs(json.data as TargetJob[]);
      } catch (e: unknown) {
        if (cancelled) return;
        setJobs([]);
        setJobsError(
          e instanceof Error ? e.message : "Failed to load target roles"
        );
      }
    }

    loadGoal();
    loadJobs();

    return () => {
      cancelled = true;
    };
  }, [id, router, refreshKey]);

  const jobsLoading = jobs === null && !jobsError;
  const jobsEmpty = jobs !== null && jobs.length === 0 && !jobsError;

  async function handleDelete() {
    if (deleting) return;
    const confirmed = window.confirm(
      "Delete this career goal?\n\nThe career goal and its target roles will be deleted. Historical analyses will be preserved."
    );
    if (!confirmed) return;

    setDeleteError(null);
    setDeleting(true);

    try {
      const res = await fetch(`/api/goals/${id}`, { method: "DELETE" });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        setDeleteError(json?.error || "Failed to delete career goal.");
        setDeleting(false);
        return;
      }

      router.push(`/dashboard/goals?r=${Date.now()}`);
    } catch (e: unknown) {
      setDeleteError(
        e instanceof Error ? e.message : "Failed to delete career goal."
      );
      setDeleting(false);
    }
  }

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

          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/goals/${id}/edit`}
              className="px-3 py-2 rounded text-sm font-medium border hover:bg-gray-50"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-2 rounded text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>

          {deleteError && (
            <div className="border border-red-200 bg-red-50 text-red-800 rounded p-3 text-sm">
              {deleteError}
            </div>
          )}

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
              <div>
                <h2 className="font-semibold text-lg">Target roles</h2>
                {jobs && jobs.length > 0 && (
                  <p className="text-sm text-gray-500 mt-1">
                    Roles you&apos;re targeting under this goal.
                  </p>
                )}
              </div>

              {jobs && jobs.length > 0 && (
                <Link
                  href={`/dashboard/goals/${id}/jobs/new`}
                  className="px-3 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800 whitespace-nowrap"
                >
                  Add target role
                </Link>
              )}
            </div>

            {jobsLoading && (
              <div className="text-sm text-gray-500">Loading target roles…</div>
            )}

            {jobsError && (
              <div className="border border-red-200 bg-red-50 text-red-800 rounded p-3 text-sm">
                {jobsError}
              </div>
            )}

            {jobsEmpty && (
              <div className="border border-dashed rounded p-6 bg-gray-50 text-center space-y-3">
                <div className="space-y-1">
                  <p className="text-sm text-gray-700 font-medium">
                    No target roles yet.
                  </p>
                  <p className="text-sm text-gray-600">
                    Add 2–5 roles to identify patterns across your target market.
                  </p>
                </div>
                <Link
                  href={`/dashboard/goals/${id}/jobs/new`}
                  className="inline-block px-4 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800"
                >
                  Add target role
                </Link>
              </div>
            )}

            {jobs && jobs.length > 0 && (
              <div className="space-y-3">
                {jobs.map((j) => {
                  const heading =
                    [j.role_title, j.company_name].filter(Boolean).join(" · ") ||
                    "Untitled role";
                  return (
                    <Link
                      key={j.id}
                      href={`/dashboard/goals/${id}/jobs/${j.id}`}
                      className="block border rounded p-4 hover:bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium">{heading}</div>
                        <span
                          className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap ${
                            j.status === "target"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {j.status}
                        </span>
                      </div>

                      <div className="text-sm text-gray-700 mt-2 leading-6">
                        {jdPreview(j.jd_text)}
                      </div>

                      <div className="text-xs text-gray-500 mt-2">
                        Added {new Date(j.created_at).toLocaleDateString()}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
