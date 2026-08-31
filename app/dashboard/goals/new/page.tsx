"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

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
      setError(e instanceof Error ? e.message : "Failed to create career goal.");
      setSubmitting(false);
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
        <h1 className="text-2xl font-bold">New career goal</h1>
        <p className="text-sm text-gray-500">
          Define the direction you&apos;re targeting. You can refine it later.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="border rounded p-5 bg-white space-y-4"
      >
        <div className="space-y-1">
          <label htmlFor="goal-title" className="text-sm font-medium">
            Title <span className="text-red-600">*</span>
          </label>
          <input
            id="goal-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Senior PM at an AI infra company"
            className="w-full border rounded px-3 py-2 text-sm"
            required
            maxLength={200}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="goal-level" className="text-sm font-medium">
              Target level <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="goal-level"
              type="text"
              value={targetLevel}
              onChange={(e) => setTargetLevel(e.target.value)}
              placeholder="e.g. Senior, Principal"
              className="w-full border rounded px-3 py-2 text-sm"
              maxLength={100}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="goal-function" className="text-sm font-medium">
              Target function <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="goal-function"
              type="text"
              value={targetFunction}
              onChange={(e) => setTargetFunction(e.target.value)}
              placeholder="e.g. Platform PM, AI PM"
              className="w-full border rounded px-3 py-2 text-sm"
              maxLength={100}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="goal-description" className="text-sm font-medium">
            Describe your career goal{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="goal-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Include the type of role, scope, domain, or career direction you want to pursue."
            className="w-full border rounded px-3 py-2 text-sm leading-6"
            rows={5}
            maxLength={2000}
          />
        </div>

        {error && (
          <div className="border border-red-200 bg-red-50 text-red-800 rounded p-3 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating…" : "Create career goal"}
          </button>
          <Link
            href="/dashboard/goals"
            className="px-4 py-2 rounded text-sm font-medium border hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
