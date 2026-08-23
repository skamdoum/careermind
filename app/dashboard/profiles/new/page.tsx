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
        setError(json?.error || "Failed to create career profile.");
        setSubmitting(false);
        return;
      }

      // Switch to the newly created profile so its scope becomes active.
      await fetch("/api/career-profiles/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: json.data.id }),
      });

      window.location.assign("/dashboard");
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to create career profile."
      );
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-1">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-black">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold">New career profile</h1>
        <p className="text-sm text-gray-500">
          A career direction you want to explore. Each profile has its own
          resumes, goals, target roles, and analyses.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="border rounded p-5 bg-white shadow-sm space-y-4"
      >
        <div className="space-y-1">
          <label htmlFor="profile-name" className="text-sm font-medium">
            Name <span className="text-red-600">*</span>
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. AI Product Management"
            className="w-full border rounded px-3 py-2 text-sm"
            required
            maxLength={200}
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="profile-description" className="text-sm font-medium">
            Description{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="profile-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short note about this direction"
            className="w-full border rounded px-3 py-2 text-sm"
            rows={3}
            maxLength={500}
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
            {submitting ? "Creating…" : "Create profile"}
          </button>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded text-sm font-medium border hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
