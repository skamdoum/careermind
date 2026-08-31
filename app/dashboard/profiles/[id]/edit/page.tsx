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
      <div className="space-y-1.5">
        <Link href="/dashboard" className="text-[13px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]">
          ← Back
        </Link>
        <h1 className="text-[24px] font-semibold tracking-[-0.01em]">Edit career profile</h1>
      </div>

      {loadStatus === "loading" && (
        <div className="text-[13px] text-[color:var(--color-text-muted)]">Loading…</div>
      )}

      {loadStatus === "not_found" && (
        <section className="rounded-[6px] border border-dashed border-[color:var(--color-border-standard)] bg-[color:var(--color-surface-elevated)] p-8 text-center space-y-3">
          <h2 className="font-semibold text-lg">Career profile not found</h2>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
          >
            Back to dashboard
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
            <label htmlFor="profile-name" className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
              Name <span className="text-[color:var(--color-danger-text)]">*</span>
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              {submitting ? "Saving…" : "Save changes"}
            </button>
            <Link
              href="/dashboard"
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
