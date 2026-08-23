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
      <div className="space-y-1">
        <Link
          href={`/dashboard/goals/${goalId}`}
          className="text-sm text-gray-500 hover:text-black"
        >
          ← Back to career goal
        </Link>
        <h1 className="text-2xl font-bold">Add target role</h1>
        <p className="text-sm text-gray-500">
          Paste the job description. Company, role title, and source URL are
          optional but help you compare later.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="border rounded p-5 bg-white shadow-sm space-y-4"
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
              placeholder="e.g. Anthropic"
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
              placeholder="e.g. Senior Product Manager, Platform"
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
            placeholder="Paste the full job description here…"
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
            {submitting ? "Adding…" : "Add target role"}
          </button>
          <Link
            href={`/dashboard/goals/${goalId}`}
            className="px-4 py-2 rounded text-sm font-medium border hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
