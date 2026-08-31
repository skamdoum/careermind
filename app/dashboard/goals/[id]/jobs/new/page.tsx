"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, use, useState } from "react";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function NewTargetJobPage({ params }: PageProps) {
  const { id: goalId } = use(params);
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [jdText, setJdText] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedJd = jdText.trim();
    if (!trimmedJd) {
      setError("Job description is required.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/goals/${goalId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd_text: trimmedJd,
          company_name: companyName.trim() ? companyName.trim() : null,
          role_title: roleTitle.trim() ? roleTitle.trim() : null,
          source_url: sourceUrl.trim() ? sourceUrl.trim() : null,
        }),
      });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      const json = await res.json();

      if (!res.ok || !json?.success) {
        setError(json?.error || "Failed to add target role.");
        setSubmitting(false);
        return;
      }

      router.push(`/dashboard/goals/${goalId}?r=${Date.now()}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add target role.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Link
          href={`/dashboard/goals/${goalId}`}
          className="text-[13px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
        >
          ← Back to career goal
        </Link>
        <h1 className="text-[24px] font-semibold tracking-[-0.01em]">Add target role</h1>
        <p className="text-[13px] text-[color:var(--color-text-muted)]">
          Paste the job description. Company, role title, and source URL are
          optional but help you compare later.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-5 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="job-company" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
              Company{" "}
              <span className="text-[color:var(--color-text-muted)] font-normal text-[12px]">(optional)</span>
            </label>
            <input
              id="job-company"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Anthropic"
              className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="job-role" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
              Role title{" "}
              <span className="text-[color:var(--color-text-muted)] font-normal text-[12px]">(optional)</span>
            </label>
            <input
              id="job-role"
              type="text"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="e.g. Senior Product Manager, Platform"
              className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
              maxLength={200}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="job-url" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
            Source URL{" "}
            <span className="text-[color:var(--color-text-muted)] font-normal text-[12px]">(optional)</span>
          </label>
          <input
            id="job-url"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
            maxLength={1000}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="job-jd" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
            Job description <span className="text-[color:var(--color-danger-text)]">*</span>
          </label>
          <textarea
            id="job-jd"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the full job description here…"
            className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[13px] font-mono leading-6 focus:outline-none focus:border-[color:var(--color-accent-ink)]"
            rows={12}
            required
          />
        </div>

        {error && (
          <div className="rounded-[6px] border border-[color:var(--color-danger-border)] bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger-text)] p-3 text-[13px]">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Adding…" : "Add target role"}
          </button>
          <Link
            href={`/dashboard/goals/${goalId}`}
            className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
