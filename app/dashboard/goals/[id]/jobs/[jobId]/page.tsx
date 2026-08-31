"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect, useState } from "react";
import PageHeader from "@/app/components/ui/PageHeader";
import SectionHeader from "@/app/components/ui/SectionHeader";
import MetaStrip from "@/app/components/ui/MetaStrip";
import Card from "@/app/components/ui/Card";
import Badge, { type BadgeVariant } from "@/app/components/ui/Badge";
import EmptyState from "@/app/components/ui/EmptyState";

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

function verdictVariant(verdict: string | undefined | null): BadgeVariant {
  if (verdict === "Strong Hire") return "success";
  if (verdict === "Borderline") return "caution";
  if (verdict === "Below Bar") return "danger";
  return "neutral";
}

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
      // Refresh the latest resume server-side right before submitting.
      // The mount-only useEffect can leave `latestResume` pointing at a
      // previous candidate when the user uploads a new resume elsewhere and
      // navigates back here — Next.js's router cache preserves the client
      // state without re-running the effect. Refetching (and letting the
      // server resolve the file by id anyway) prevents any stale identity
      // from steering the analysis at the wrong resume.
      let resumeIdToSend = latestResume.id;
      try {
        const refreshRes = await fetch("/api/resumes/latest", {
          cache: "no-store",
        });
        if (refreshRes.ok) {
          const refreshJson = await refreshRes.json().catch(() => null);
          if (refreshJson?.success && refreshJson.data?.id) {
            resumeIdToSend = refreshJson.data.id as string;
            setLatestResume(refreshJson.data);
          }
        }
      } catch {
        // Non-fatal — fall through with whatever id we already have.
      }

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          career_goal_id: goalId,
          job_description_id: jobId,
          resume_id: resumeIdToSend,
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
      <div className="text-[13px]">
        <Link
          href={`/dashboard/goals/${goalId}`}
          className="text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
        >
          ← Back to career goal
        </Link>
      </div>

      {status === "loading" && (
        <div className="text-[13px] text-[color:var(--color-text-muted)]">
          Loading target role…
        </div>
      )}

      {status === "not_found" && (
        <EmptyState
          title="Target role not found"
          description="It may have been deleted, or the link is incorrect."
          action={
            <Link
              href={`/dashboard/goals/${goalId}`}
              className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
            >
              Back to career goal
            </Link>
          }
        />
      )}

      {status === "error" && (
        <Card intent="danger" padding="md">
          <div className="text-[13px]">{error}</div>
        </Card>
      )}

      {status === "ok" && job !== null && (
        <>
          <PageHeader
            title={job.role_title || "Untitled role"}
            action={
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/goals/${goalId}/jobs/${jobId}/edit`}
                  className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] px-3 py-1.5 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-[13px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger-text)] disabled:opacity-60 disabled:cursor-not-allowed underline underline-offset-2"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            }
          />

          <MetaStrip
            items={[
              {
                label: "Company",
                value: job.company_name || "Not specified",
              },
              {
                label: "Added",
                value: new Date(job.created_at).toLocaleDateString(),
              },
              {
                label: "Status",
                value: (
                  <Badge variant={job.status === "target" ? "info" : "neutral"}>
                    {job.status}
                  </Badge>
                ),
              },
            ]}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing || !resumeChecked || !latestResume}
              className={
                "inline-flex items-center rounded-[6px] px-4 py-2 text-[13px] font-medium transition " +
                (analyzing || !resumeChecked || !latestResume
                  ? "bg-[color:var(--color-surface-elevated)] text-[color:var(--color-text-muted)] cursor-not-allowed"
                  : "bg-[color:var(--color-accent-ink)] text-white hover:opacity-90")
              }
              title={
                !latestResume && resumeChecked
                  ? "Upload a resume first"
                  : undefined
              }
            >
              {analyzing ? "Analyzing…" : "Analyze this role"}
            </button>
          </div>

          {resumeChecked && !latestResume && (
            <Card intent="caution" padding="md">
              <div className="text-[13px]">
                You need a resume on file to run an analysis.{" "}
                <Link
                  href="/analyze"
                  className="underline underline-offset-2 font-medium"
                >
                  Upload a resume
                </Link>
                , then come back to analyze this role.
              </div>
            </Card>
          )}

          {analyzing && (
            <div className="rounded-[6px] bg-[color:var(--color-surface-elevated)] px-4 py-3 text-[13px] text-[color:var(--color-text-secondary)]">
              Running analysis against this role — this can take up to a
              minute.
            </div>
          )}

          {analyzeError && (
            <Card intent="danger" padding="md">
              <div className="text-[13px]">{analyzeError}</div>
            </Card>
          )}

          {deleteError && (
            <Card intent="danger" padding="md">
              <div className="text-[13px]">{deleteError}</div>
            </Card>
          )}

          {job.source_url && (
            <section className="space-y-2">
              <SectionHeader title="Source" />
              <a
                href={job.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-[color:var(--color-accent-ink)] underline underline-offset-2 break-all"
              >
                {job.source_url}
              </a>
            </section>
          )}

          <section className="space-y-4">
            <SectionHeader
              title="Analysis history"
              meta={
                analyses !== null && analyses.length > 0
                  ? `${analyses.length} analys${
                      analyses.length === 1 ? "is" : "es"
                    }`
                  : undefined
              }
            />

            {analyses === null && !analysesError && (
              <div className="text-[13px] text-[color:var(--color-text-muted)]">
                Loading analyses…
              </div>
            )}

            {analysesError && (
              <Card intent="danger" padding="md">
                <div className="text-[13px]">{analysesError}</div>
              </Card>
            )}

            {analyses !== null && analyses.length === 0 && !analysesError && (
              <EmptyState
                title="No analyses yet"
                description="Run your first analysis for this role."
              />
            )}

            {analyses !== null && analyses.length > 0 && (
              <div className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-border-subtle)] overflow-hidden">
                {analyses.map((a) => {
                  const verdict = a.raw_json?.core_verdict;
                  return (
                    <Link
                      key={a.id}
                      href={`/dashboard/${a.id}`}
                      className="block px-4 py-3 hover:bg-[color:var(--color-surface-elevated)] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)] whitespace-nowrap">
                            {new Date(a.created_at).toLocaleString()}
                          </span>
                          {verdict && (
                            <Badge variant={verdictVariant(verdict)}>
                              {verdict}
                            </Badge>
                          )}
                        </div>
                        <span
                          className="text-[color:var(--color-text-muted)]"
                          aria-hidden
                        >
                          →
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <SectionHeader title="Job description" />
            <pre className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-4 text-[13px] leading-[1.6] text-[color:var(--color-text-primary)] whitespace-pre-wrap font-sans">
              {job.jd_text}
            </pre>
          </section>
        </>
      )}
    </>
  );
}
