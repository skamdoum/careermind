"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, use, useEffect, useState } from "react";

type TargetJob = {
  id: string;
  career_goal_id: string | null;
  company_name: string | null;
  role_title: string | null;
  source_url: string | null;
  jd_text: string;
  status: string;
};

type PageProps = {
  params: Promise<{ id: string; jobId: string }>;
};

export default function EditTargetJobPage({ params }: PageProps) {
  const { id: goalId, jobId } = use(params);
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [jdText, setJdText] = useState("");

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
    setCompanyName("");
    setRoleTitle("");
    setSourceUrl("");
    setJdText("");

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
          if (!cancelled) setLoadStatus("not_found");
          return;
        }

        const json = await res.json();
        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setLoadError(json?.error || "Failed to load target role");
          setLoadStatus("error");
          return;
        }

        const j = json.data as TargetJob;
        setCompanyName(j.company_name || "");
        setRoleTitle(j.role_title || "");
        setSourceUrl(j.source_url || "");
        setJdText(j.jd_text || "");
        setLoadStatus("ok");
      } catch (e: unknown) {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Failed to load target role"
        );
        setLoadStatus("error");
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [goalId, jobId, router]);

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
      const res = await fetch(`/api/goals/${goalId}/jobs/${jobId}`, {
        method: "PATCH",
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
        setError(json?.error || "Failed to save changes.");
        setSubmitting(false);
        return;
      }

      router.push(`/dashboard/goals/${goalId}/jobs/${jobId}?r=${Date.now()}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save changes.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-1">
        <Link
          href={`/dashboard/goals/${goalId}/jobs/${jobId}`}
          className="text-sm text-gray-500 hover:text-black"
        >
          ← Back to target role
        </Link>
        <h1 className="text-2xl font-bold">Edit target role</h1>
      </div>

      {loadStatus === "loading" && (
        <div className="text-sm text-gray-500">Loading…</div>
      )}

      {loadStatus === "not_found" && (
        <section className="border border-dashed rounded p-8 bg-white text-center space-y-3">
          <h2 className="font-semibold text-lg">Target role not found</h2>
          <Link
            href={`/dashboard/goals/${goalId}`}
            className="inline-block px-4 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800"
          >
            Back to career goal
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="job-company" className="text-sm font-medium">
                Company{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="job-company"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                maxLength={200}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="job-role" className="text-sm font-medium">
                Role title{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="job-role"
                type="text"
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                maxLength={200}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="job-url" className="text-sm font-medium">
              Source URL{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="job-url"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
              className="w-full border rounded px-3 py-2 text-sm"
              maxLength={1000}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="job-jd" className="text-sm font-medium">
              Job description <span className="text-red-600">*</span>
            </label>
            <textarea
              id="job-jd"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm font-mono leading-6"
              rows={12}
              required
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
              href={`/dashboard/goals/${goalId}/jobs/${jobId}`}
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
