"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import PageHeader from "@/app/components/ui/PageHeader";
import Card from "@/app/components/ui/Card";

const INPUT_CLASS =
  "w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] focus:outline-none focus:border-[color:var(--color-accent-ink)]";
const LABEL_CLASS =
  "text-[13px] font-semibold text-[color:var(--color-text-primary)]";
const HINT_CLASS =
  "text-[color:var(--color-text-muted)] font-normal text-[12px]";

export default function NewGoalPage() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [targetLevel, setTargetLevel] = useState("");
  const [targetFunction, setTargetFunction] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch("/api/goals", {
        method: "POST",
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
        setError(json?.error || "Failed to create career goal.");
        setSubmitting(false);
        return;
      }

      router.push(`/dashboard/goals/${json.data.id}?r=${Date.now()}`);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to create career goal."
      );
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="text-[13px]">
        <Link
          href="/dashboard/goals"
          className="text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
        >
          ← Back to Career Goals
        </Link>
      </div>

      <PageHeader
        title="New career goal"
        description="Define the direction you're targeting. You can refine it later."
      />

      <Card padding="lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="goal-title" className={LABEL_CLASS}>
              Title <span className="text-[color:var(--color-danger-text)]">*</span>
            </label>
            <input
              id="goal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior PM at an AI infra company"
              className={INPUT_CLASS}
              required
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="goal-level" className={LABEL_CLASS}>
                Target level <span className={HINT_CLASS}>(optional)</span>
              </label>
              <input
                id="goal-level"
                type="text"
                value={targetLevel}
                onChange={(e) => setTargetLevel(e.target.value)}
                placeholder="e.g. Senior, Principal"
                className={INPUT_CLASS}
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="goal-function" className={LABEL_CLASS}>
                Target function <span className={HINT_CLASS}>(optional)</span>
              </label>
              <input
                id="goal-function"
                type="text"
                value={targetFunction}
                onChange={(e) => setTargetFunction(e.target.value)}
                placeholder="e.g. Platform PM, AI PM"
                className={INPUT_CLASS}
                maxLength={100}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="goal-description" className={LABEL_CLASS}>
              Describe your career goal{" "}
              <span className={HINT_CLASS}>(optional)</span>
            </label>
            <textarea
              id="goal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Include the type of role, scope, domain, or career direction you want to pursue."
              className={INPUT_CLASS + " leading-6"}
              rows={5}
              maxLength={2000}
            />
          </div>

          {error && (
            <Card intent="danger" padding="md">
              <div className="text-[13px]">{error}</div>
            </Card>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Creating…" : "Create career goal"}
            </button>
            <Link
              href="/dashboard/goals"
              className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            >
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
