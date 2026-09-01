"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, use, useEffect, useState } from "react";

type CareerGoal = {
  id: string;
  title: string;
  target_level: string | null;
  target_function: string | null;
  description: string | null;
  status: string;
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function EditGoalPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [targetLevel, setTargetLevel] = useState("");
  const [targetFunction, setTargetFunction] = useState("");
  const [description, setDescription] = useState("");

  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ok" | "not_found" | "error"
  >("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoadStatus("loading");
    setLoadError(null);
    setTitle("");
    setTargetLevel("");
    setTargetFunction("");
    setDescription("");

    async function load() {
      try {
        const res = await fetch(`/api/goals/${id}`, { cache: "no-store" });

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        if (res.status === 404) {
          if (!cancelled) setLoadStatus("not_found");
          return;
        }

        const json = await res.json();
        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setLoadError(json?.error || "Failed to load career goal");
          setLoadStatus("error");
          return;
        }

        const g = json.data as CareerGoal;
        setTitle(g.title || "");
        setTargetLevel(g.target_level || "");
        setTargetFunction(g.target_function || "");
        setDescription(g.description || "");
        setLoadStatus("ok");
      } catch (e: unknown) {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Failed to load career goal"
        );
        setLoadStatus("error");
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [id, router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/goals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          target_level: targetLevel.trim() ? targetLevel.trim() : null,
          target_function: targetFunction.trim() ? targetFunction.trim() : null,
          description: description.trim() ? description.trim() : null,
        }),
      });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      const json = await res.json();

      if (!res.ok || !json?.success) {
        setError(json?.error || "Failed to save changes.");
        setSubmitting(false);
        return;
      }

      router.push(`/dashboard/goals/${id}?r=${Date.now()}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save changes.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Link
          href={`/dashboard/goals/${id}`}
          className="text-[13px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
        >
          ← Back to career goal
        </Link>
        <h1 className="text-[24px] font-semibold tracking-[-0.01em]">Edit career goal</h1>
      </div>

      {loadStatus === "loading" && (
        <div className="text-[13px] text-[color:var(--color-text-muted)]">Loading…</div>
      )}

      {loadStatus === "not_found" && (
        <section className="rounded-[6px] border border-dashed border-[color:var(--color-border-standard)] bg-[color:var(--color-surface-elevated)] p-8 text-center space-y-3">
          <h2 className="font-semibold text-lg">Career goal not found</h2>
          <Link
            href="/dashboard/goals"
            className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
          >
            Back to Career Goals
          </Link>
        </section>
      )}

      {loadStatus === "error" && (
        <div className="rounded-[6px] border border-[color:var(--color-danger-border)] bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger-text)] p-4 text-[13px]">
          {loadError}
        </div>
      )}

      {loadStatus === "ok" && (
        <form
          onSubmit={handleSubmit}
          className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-5 space-y-5"
        >
          <div className="space-y-1.5">
            <label htmlFor="goal-title" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
              Title <span className="text-[color:var(--color-danger-text)]">*</span>
            </label>
            <input
              id="goal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
              required
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="goal-level" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
                Target level{" "}
                <span className="text-[color:var(--color-text-muted)] font-normal text-[12px]">(optional)</span>
              </label>
              <input
                id="goal-level"
                type="text"
                value={targetLevel}
                onChange={(e) => setTargetLevel(e.target.value)}
                className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="goal-function" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
                Target function{" "}
                <span className="text-[color:var(--color-text-muted)] font-normal text-[12px]">(optional)</span>
              </label>
              <input
                id="goal-function"
                type="text"
                value={targetFunction}
                onChange={(e) => setTargetFunction(e.target.value)}
                className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
                maxLength={100}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="goal-description" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
              Describe your career goal{" "}
              <span className="text-[color:var(--color-text-muted)] font-normal text-[12px]">(optional)</span>
            </label>
            <textarea
              id="goal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Include the type of role, scope, domain, or direction you want to pursue."
              className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]"
              rows={5}
              maxLength={2000}
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
              {submitting ? "Saving…" : "Save changes"}
            </button>
            <Link
              href={`/dashboard/goals/${id}`}
              className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </>
  );
}
