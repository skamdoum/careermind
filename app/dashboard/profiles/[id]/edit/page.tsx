"use client";

import Link from "next/link";
import { FormEvent, use, useEffect, useState } from "react";

type CareerProfile = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function EditCareerProfilePage({ params }: PageProps) {
  const { id } = use(params);

  const [name, setName] = useState("");
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
    setName("");
    setDescription("");

    async function load() {
      try {
        const res = await fetch(`/api/career-profiles/${id}`, {
          cache: "no-store",
        });

        if (res.status === 401) {
          window.location.assign("/login");
          return;
        }

        if (res.status === 404) {
          if (!cancelled) setLoadStatus("not_found");
          return;
        }

        const json = await res.json().catch(() => null);
        if (cancelled) return;

        if (!res.ok || !json?.success) {
          setLoadError(json?.error || "Failed to load career profile");
          setLoadStatus("error");
          return;
        }

        const p = json.data as CareerProfile;
        setName(p.name || "");
        setDescription(p.description || "");
        setLoadStatus("ok");
      } catch (e: unknown) {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Failed to load career profile"
        );
        setLoadStatus("error");
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [id]);

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
      const res = await fetch(`/api/career-profiles/${id}`, {
        method: "PATCH",
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
        setError(json?.error || "Failed to save changes.");
        setSubmitting(false);
        return;
      }

      window.location.assign("/dashboard");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save changes.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-1">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-black">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold">Edit career profile</h1>
      </div>

      {loadStatus === "loading" && (
        <div className="text-sm text-gray-500">Loading…</div>
      )}

      {loadStatus === "not_found" && (
        <section className="border border-dashed rounded p-8 bg-white text-center space-y-3">
          <h2 className="font-semibold text-lg">Career profile not found</h2>
          <Link
            href="/dashboard"
            className="inline-block px-4 py-2 rounded text-sm font-medium bg-black text-white hover:bg-gray-800"
          >
            Back to dashboard
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
            <label htmlFor="profile-name" className="text-sm font-medium">
              Name <span className="text-red-600">*</span>
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              {submitting ? "Saving…" : "Save changes"}
            </button>
            <Link
              href="/dashboard"
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
