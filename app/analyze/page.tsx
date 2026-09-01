"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AppShell from "@/app/components/app-shell";
import PageHeader from "@/app/components/ui/PageHeader";
import SectionHeader from "@/app/components/ui/SectionHeader";
import Card from "@/app/components/ui/Card";
import Badge from "@/app/components/ui/Badge";
import EmptyState from "@/app/components/ui/EmptyState";
import DropZone from "@/app/components/ui/DropZone";
import VerdictHero from "@/app/components/ui/VerdictHero";

export default function AnalyzePage() {
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [uploadedResume, setUploadedResume] = useState<any>(null);
  const [latestResume, setLatestResume] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState("Ready to analyze your profile");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    async function loadUserAndResume() {
      setResult(null);
      setStatus("Ready to analyze your profile");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserId(null);
        return;
      }

      setUserId(user.id);

      const res = await fetch("/api/resumes/latest");
      const data = await res.json();

      if (!res.ok) {
        if (data.data?.code === "LIMIT_REACHED") {
          setStatus("You've reached the free analysis limit for the beta.");
          return;
        }

        setStatus(data.error || "Failed to load your latest resume");
        return;
      }

      if (data?.data) {
        setLatestResume(data.data);
      }
    }

    loadUserAndResume();
  }, [supabase]);

  // Auto-upload as soon as the user chooses a file. Picking a file IS
  // the commit — no separate button. Prevents the analysis flow from
  // ever running against a stale "latest" resume simply because the
  // user forgot to click a second button.
  async function uploadResumeFile(file: File) {
    if (!userId) {
      setUploadError("You must be logged in to upload a resume.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setStatus("Uploading resume…");

    try {
      const fileExt = file.name.split(".").pop();
      const filePath = `${userId}/${Date.now()}.${fileExt}`;

      const { error: storageError } = await supabase.storage
        .from("resumes")
        .upload(filePath, file, {
          upsert: false,
          contentType: file.type,
        });

      if (storageError) {
        throw storageError;
      }

      const res = await fetch("/api/resumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath,
          fileName: file.name,
          mimeType: file.type,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save resume metadata");
      }

      setUploadedResume(data.data);
      setLatestResume(data.data);
      setStatus("Resume uploaded");
    } catch (error: any) {
      console.error(error);
      setUploadError(error.message || "Upload failed");
      setStatus("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleAnalyze() {
    if (!userId) {
      setStatus("You must be logged in");
      return;
    }

    setLoading(true);
    setStatus("Analyzing your profile… this may take up to a minute.");
    setResult(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          resumeText,
          jobDescription,
          targetRole: "PM",
          targetLevel: "Senior",
          // The server always resolves the actual file from this id
          // against the user + active career profile. Client-supplied
          // file_path / file_name metadata is deliberately not sent.
          resume_id: latestResume?.id ?? null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.data?.code === "LIMIT_REACHED") {
          setStatus("You've reached the free analysis limit for the beta.");
          return;
        }

        setStatus(data.error || "Analyze failed");
        setResult({ error: data.error || "Analyze failed" });
        return;
      }

      setStatus("Analysis complete");
      setResult(data.data?.result);
    } catch (error) {
      console.error(error);
      setStatus("Request failed");
      setResult({ error: "Request failed" });
    } finally {
      setLoading(false);
    }
  }

  const canAnalyze =
    !loading && !!userId && (!!latestResume || !!resumeText) && !!jobDescription;

  return (
    <AppShell width="standard">
      <PageHeader
        title="Analyze Your Fit"
        description="Upload your resume, paste a target job description, and get a structured evaluation of your strengths, biggest gaps, and highest-leverage next steps."
      />

      <div className="rounded-[6px] bg-[color:var(--color-surface-elevated)] px-4 py-3 text-[13px] text-[color:var(--color-text-secondary)]">
        <span className="text-[color:var(--color-text-primary)] font-semibold">One-off analysis.</span>{" "}
        Results here won&apos;t roll up into any career goal&apos;s cross-role
        patterns or Strategy. For a role you&apos;re actually targeting,{" "}
        <Link
          href="/dashboard/goals"
          className="underline underline-offset-2 hover:text-[color:var(--color-text-primary)]"
        >
          start from your career goal →
        </Link>
      </div>

      <Card padding="lg">
        <div className="space-y-4">
          <SectionHeader
            eyebrow="Step 1"
            title="Resume"
            description="Choose a file and it uploads automatically. To swap, just pick a different file."
          />

          {latestResume ? (
            <div className="rounded-[6px] bg-[color:var(--color-accent-ink-tint)] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                Current resume
              </div>
              <div className="text-[14px] font-semibold text-[color:var(--color-text-primary)] mt-0.5">
                {latestResume.file_name}
              </div>
            </div>
          ) : (
            <div className="text-[13px] text-[color:var(--color-text-muted)]">
              No resume uploaded yet.
            </div>
          )}

          <DropZone
            accept=".pdf,.doc,.docx,.txt"
            disabled={uploading || !userId}
            onFile={(f) => uploadResumeFile(f)}
            label={
              latestResume
                ? "Replace with a different file"
                : "Upload your resume"
            }
            hint={
              latestResume
                ? "PDF, DOC, DOCX, or TXT"
                : "Upload once and use it across your target roles · PDF, DOC, DOCX, or TXT"
            }
          />

          {uploading && (
            <div className="text-[13px] text-[color:var(--color-text-secondary)]">
              Uploading…
            </div>
          )}

          {uploadError && (
            <div className="text-[13px] text-[color:var(--color-danger-text)]">
              {uploadError}
            </div>
          )}

          {uploadedResume && !uploading && !uploadError && (
            <div className="text-[13px] text-[color:var(--color-success-text)]">
              Uploaded: {uploadedResume.file_name}
            </div>
          )}

          <details className="text-[13px] text-[color:var(--color-text-secondary)]">
            <summary className="cursor-pointer select-none">
              Or paste resume text as a fallback
            </summary>
            <p className="text-[12px] text-[color:var(--color-text-muted)] mt-2">
              Uploaded file is preferred. Only use this if you cannot upload a file.
            </p>
            <textarea
              className="mt-2 w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-3 min-h-[140px] text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
              placeholder="Paste resume text"
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
            />
          </details>
        </div>
      </Card>

      <Card padding="lg">
        <div className="space-y-4">
          <SectionHeader
            eyebrow="Step 2"
            title="Target role"
            description="Paste the job description for the role you want to evaluate against."
          />
          <textarea
            className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-3 min-h-[220px] text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
            placeholder="Paste job description here"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
          />
        </div>
      </Card>

      <EmptyState
        title={
          <span className="flex items-center justify-center gap-2">
            <span>Compare multiple roles</span>
            <Badge variant="neutral">Coming soon</Badge>
          </span>
        }
        description="Weigh 2–3 target roles against your resume and career goal in one pass. Ships with a future release — for now, analyze roles one at a time from your career goals."
      />

      <Card padding="lg">
        <div className="space-y-4">
          <SectionHeader
            eyebrow="Step 3"
            title="Analyze"
            description="CareerMind will evaluate fit, identify gaps, and generate an action plan."
          />

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className={
              "w-full rounded-[6px] px-5 py-3 text-[14px] font-medium transition " +
              (canAnalyze
                ? "bg-[color:var(--color-accent-ink)] text-white hover:opacity-90"
                : "bg-[color:var(--color-surface-elevated)] text-[color:var(--color-text-muted)] cursor-not-allowed")
            }
          >
            {loading ? "Analyzing…" : "Run Analysis"}
          </button>

          <div className="text-[12px] text-[color:var(--color-text-muted)]">
            Free during beta.
          </div>

          {status?.toLowerCase().includes("limit") && (
            <Card intent="caution" padding="md">
              <div className="text-[14px] font-semibold">Free limit reached</div>
              <div className="text-[13px] mt-1">
                You&apos;ve hit the free analysis limit for the beta. Reach out
                to your CareerMind contact if you need it raised for testing.
              </div>
            </Card>
          )}

          <div className="rounded-[6px] bg-[color:var(--color-surface-elevated)] px-4 py-3 text-[13px] text-[color:var(--color-text-secondary)]">
            {status || "Ready to analyze your profile"}
          </div>
        </div>
      </Card>

      {result && !result.error && (
        <div className="space-y-6">
          <VerdictHero
            verdict={result.core_verdict}
            summary={result.positioning_summary}
          />

          {result.plan?.next_best_action && (
            <Card intent="info" padding="lg">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80 mb-2">
                Next best action
              </div>
              <p className="text-[15px] leading-[1.6] text-[color:var(--color-text-primary)]">
                {result.plan.next_best_action}
              </p>
            </Card>
          )}

          {result.gaps && result.gaps.length > 0 && (
            <section className="space-y-3">
              <SectionHeader title="Top gaps" />
              {result.gaps.slice(0, 3).map((gap: any, i: number) => (
                <Card key={i} padding="md">
                  <div className="text-[15px] font-semibold text-[color:var(--color-text-primary)]">
                    {gap.gap_title || `Gap ${i + 1}`}
                  </div>
                  <p className="text-[14px] leading-[1.6] text-[color:var(--color-text-secondary)] mt-1">
                    {gap.gap_description}
                  </p>
                </Card>
              ))}
            </section>
          )}

          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
            >
              Go to dashboard
            </Link>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            >
              Run another analysis
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
