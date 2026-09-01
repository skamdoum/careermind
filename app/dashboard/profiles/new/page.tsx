"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function NewCareerProfilePage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/career-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
        }),
      });

      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        setError(json?.error || "Failed to create job search.");
        setSubmitting(false);
        return;
      }

      // Switch to the newly created search so its scope becomes active.
      await fetch("/api/career-profiles/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: json.data.id }),
      });

      window.location.assign("/dashboard");
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to create job search."
      );
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Link href="/dashboard" className="text-[13px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]">
          ← Back
        </Link>
        <h1 className="text-[24px] font-semibold tracking-[-0.01em]">New job search</h1>
        <p className="text-[13px] text-[color:var(--color-text-muted)]">
          A separate workspace for a parallel job search. Each search has
          its own resumes, career goals, target roles, and analyses — so
          patterns don&apos;t mix.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-5 space-y-5"
      >
        <div className="space-y-1.5">
          <label htmlFor="profile-name" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
            Name <span className="text-[color:var(--color-danger-text)]">*</span>
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Senior AI Product Management search"
            className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
            required
            maxLength={200}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="profile-description" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
            Description{" "}
            <span className="text-[color:var(--color-text-muted)] font-normal text-[12px]">(optional)</span>
          </label>
          <textarea
            id="profile-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short note about this search — e.g. what direction, why it's separate"
            className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
            rows={3}
            maxLength={500}
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
            {submitting ? "Creating…" : "Create job search"}
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
