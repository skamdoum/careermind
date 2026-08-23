"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect, useState } from "react";

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
  params: Promise<{ id: string; jobId: string }>;
};

export default function TargetJobDetailPage({ params }: PageProps) {
  const { id: goalId, jobId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const refreshKey = searchParams.get("r") ?? "";

  const [job, setJob] = useState<TargetJob | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "not_found" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (deleting) return;
    const confirmed = window.confirm(
      "Delete this target role?\n\nHistorical analyses will be preserved but will no longer be linked to this role."
    );
    if (!confirmed) return;

    setDeleteError(null);
    setDeleting(true);

    try {
      const res = await fetch(`/api/goals/${goalId}/jobs/${jobId}`, {
        method: "DELETE",
      });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        setDeleteError(json?.error || "Failed to delete target role.");
        setDeleting(false);
        return;
      }

      window.location.assign(`/dashboard/goals/${goalId}`);
    } catch (e: unknown) {
      setDeleteError(
        e instanceof Error ? e.message : "Failed to delete target role."
      );
      setDeleting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    setJob(null);
    setStatus("loading");
    setError(null);

    async function load() {
      try {
        const res = await fetch(`/api/goals/${goalId}/jobs/${jobId}`, {
          cache: "no-store",
        });

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        if (res.status === 404) {
          if (!cancelled) {
            setJob(null);
            setStatus("not_found");
          }
          return;
        }

        const json = await res.json();
        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setJob(null);
          setError(json?.error || "Failed to load target role");
          setStatus("error");
          return;
        }

        setJob(json.data as TargetJob);
        setStatus("ok");
      } catch (e: unknown) {
        if (cancelled) return;
        setJob(null);
        setError(e instanceof Error ? e.message : "Failed to load target role");
        setStatus("error");
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [goalId, jobId, router, refreshKey]);

  return (
    <>
      <div className="space-y-1">
        <Link
          href={`/dashboard/goals/${goalId}`}
          className="text-sm text-gray-500 hover:text-black"
        >
          ← Back to career goal
        </Link>
      </div>

      {status === "loading" && (
        <div className="text-sm text-gray-500">Loading target role…</div>
      )}

      {status === "not_found" && (
        <section className="border border-dashed rounded p-8 bg-white text-center space-y-3">
          <h2 className="font-semibold text-lg">Target role not found</h2>
          <p className="text-sm text-gray-600">
            It may have been deleted, or the link is incorrect.
          </p>
          <Link
            href={`/dashboard/goals/${goalId}`}
            className="inline-block px-4 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800"
          >
            Back to career goal
          </Link>
        </section>
      )}

      {status === "error" && (
        <div className="border border-red-200 bg-red-50 text-red-800 rounded p-4 text-sm">
          {error}
        </div>
      )}

      {status === "ok" && job !== null && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold">
                {job.role_title || "Untitled role"}
              </h1>
              <p className="text-sm text-gray-500">
                {job.company_name || "Company not specified"} · Added{" "}
                {new Date(job.created_at).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap ${
                job.status === "target"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {job.status}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/goals/${goalId}/jobs/${jobId}/edit`}
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

          {job.source_url && (
            <section className="border rounded p-5 bg-white shadow-sm">
              <h2 className="font-semibold text-lg mb-2">Source</h2>
              <a
                href={job.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 underline break-all"
              >
                {job.source_url}
              </a>
            </section>
          )}

          <section className="border rounded p-5 bg-white shadow-sm">
            <h2 className="font-semibold text-lg mb-3">Job description</h2>
            <pre className="text-sm text-gray-800 leading-6 whitespace-pre-wrap font-sans">
              {job.jd_text}
            </pre>
          </section>
        </>
      )}
    </>
  );
}
