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
      <div className="space-y-1">
        <Link
          href={`/dashboard/goals/${id}`}
          className="text-sm text-gray-500 hover:text-black"
        >
          ← Back to career goal
        </Link>
        <h1 className="text-2xl font-bold">Edit career goal</h1>
      </div>

      {loadStatus === "loading" && (
        <div className="text-sm text-gray-500">Loading…</div>
      )}

      {loadStatus === "not_found" && (
        <section className="border border-dashed rounded p-8 bg-white text-center space-y-3">
          <h2 className="font-semibold text-lg">Career goal not found</h2>
          <Link
            href="/dashboard/goals"
            className="inline-block px-4 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800"
          >
            Back to Career Goals
          </Link>
        </section>
      )}

      {loadStatus === "error" && (
        <div className="border border-red-200 bg-red-50 text-red-800 rounded p-4 text-sm">
          {loadError}
        </div>
      )}

      {loadStatus === "ok" && (
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
              className="w-full border rounded px-3 py-2 text-sm"
              required
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="goal-level" className="text-sm font-medium">
                Target level{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="goal-level"
                type="text"
                value={targetLevel}
                onChange={(e) => setTargetLevel(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                maxLength={100}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="goal-function" className="text-sm font-medium">
                Target function{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="goal-function"
                type="text"
                value={targetFunction}
                onChange={(e) => setTargetFunction(e.target.value)}
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
              {submitting ? "Saving…" : "Save changes"}
            </button>
            <Link
              href={`/dashboard/goals/${id}`}
              className="px-4 py-2 rounded text-sm font-medium border hover:bg-gray-50"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </>
  );
}
