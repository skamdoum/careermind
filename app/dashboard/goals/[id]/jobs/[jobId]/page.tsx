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

type AnalysisSummary = {
  id: string;
  summary: string | null;
  created_at: string;
  raw_json: { core_verdict?: string } | null;
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

  const [latestResume, setLatestResume] = useState<{
    id: string;
    file_name?: string | null;
  } | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [analyses, setAnalyses] = useState<AnalysisSummary[] | null>(null);
  const [analysesError, setAnalysesError] = useState<string | null>(null);

  async function handleAnalyze() {
    if (analyzing) return;

    if (!latestResume) {
      setAnalyzeError(
        "Upload a resume first, then come back to run the analysis."
      );
      return;
    }

    setAnalyzeError(null);
    setAnalyzing(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          career_goal_id: goalId,
          job_description_id: jobId,
          latestResume,
        }),
      });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        if (json?.data?.code === "LIMIT_REACHED") {
          setAnalyzeError(
            "You've reached the free analysis limit. Upgrade to continue."
          );
        } else {
          setAnalyzeError(json?.error || "Failed to run analysis.");
        }
        setAnalyzing(false);
        return;
      }

      const analysisId = json.data?.analysisId;
      if (!analysisId) {
        setAnalyzeError("Analysis succeeded but no analysis id was returned.");
        setAnalyzing(false);
        return;
      }

      window.location.assign(`/dashboard/${analysisId}`);
    } catch (e: unknown) {
      setAnalyzeError(
        e instanceof Error ? e.message : "Failed to run analysis."
      );
      setAnalyzing(false);
    }
  }

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
    setLatestResume(null);
    setResumeChecked(false);
    setAnalyses(null);
    setAnalysesError(null);

    async function loadJob() {
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

    async function loadResume() {
      try {
        const res = await fetch("/api/resumes/latest", { cache: "no-store" });
        if (res.status === 401) return;
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && json?.success && json.data) {
          setLatestResume(json.data);
        }
      } catch {
        // Non-fatal — CTA will show the "upload a resume first" hint.
      } finally {
        if (!cancelled) setResumeChecked(true);
      }
    }

    async function loadAnalyses() {
      try {
        const res = await fetch(
          `/api/goals/${goalId}/jobs/${jobId}/analyses`,
          { cache: "no-store" }
        );

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        if (res.status === 404) {
          if (!cancelled) setAnalyses([]);
          return;
        }

        const json = await res.json().catch(() => null);
        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setAnalyses([]);
          setAnalysesError(json?.error || "Failed to load analysis history");
          return;
        }

        setAnalyses(json.data as AnalysisSummary[]);
      } catch (e: unknown) {
        if (cancelled) return;
        setAnalyses([]);
        setAnalysesError(
          e instanceof Error ? e.message : "Failed to load analysis history"
        );
      }
    }

    loadJob();
    loadResume();
    loadAnalyses();

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

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing || !resumeChecked || !latestResume}
              className="px-4 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
              title={
                !latestResume && resumeChecked
                  ? "Upload a resume first"
                  : undefined
              }
            >
              {analyzing ? "Analyzing…" : "Analyze this role"}
            </button>

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

          {resumeChecked && !latestResume && (
            <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded p-3 text-sm">
              You need a resume on file to run an analysis.{" "}
              <Link href="/analyze" className="underline font-medium">
                Upload a resume
              </Link>
              , then come back to analyze this role.
            </div>
          )}

          {analyzing && (
            <div className="border rounded p-3 bg-gray-50 text-sm text-gray-700">
              Running analysis against this role — this can take up to a minute.
            </div>
          )}

          {analyzeError && (
            <div className="border border-red-200 bg-red-50 text-red-800 rounded p-3 text-sm">
              {analyzeError}
            </div>
          )}

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
            <h2 className="font-semibold text-lg mb-3">Analysis history</h2>

            {analyses === null && !analysesError && (
              <div className="text-sm text-gray-500">Loading analyses…</div>
            )}

            {analysesError && (
              <div className="border border-red-200 bg-red-50 text-red-800 rounded p-3 text-sm">
                {analysesError}
              </div>
            )}

            {analyses !== null && analyses.length === 0 && !analysesError && (
              <div className="text-sm text-gray-500">
                No analyses yet. Run your first analysis for this role.
              </div>
            )}

            {analyses !== null && analyses.length > 0 && (
              <div className="space-y-3">
                {analyses.map((a) => {
                  const verdict = a.raw_json?.core_verdict;
                  return (
                    <Link
                      key={a.id}
                      href={`/dashboard/${a.id}`}
                      className="block border rounded p-4 hover:bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm text-gray-500">
                          {new Date(a.created_at).toLocaleString()}
                        </div>
                        {verdict && (
                          <span
                            className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap ${
                              verdict === "Strong Hire"
                                ? "bg-green-100 text-green-800"
                                : verdict === "Borderline"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {verdict}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-blue-600 mt-2">
                        View analysis →
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

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
