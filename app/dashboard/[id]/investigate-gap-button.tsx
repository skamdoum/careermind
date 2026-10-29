"use client";

import Link from "next/link";
import type { SavedInvestigation } from "@/lib/gap-investigation/saved";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  gapId: string;
  className?: string;
  saved: { primary: SavedInvestigation | null; history: SavedInvestigation[] };
  loadError?: string | null;
};

// Existing records are plain navigation links. Only a gap without a reusable
// investigation invokes the start endpoint. The ref guards clicks before render.
export default function InvestigateGapButton({ gapId, className, saved, loadError }: Props) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (pending.current || loadError) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/gap-investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gap_id: gapId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Could not start investigation");
      }
      const investigationId = json.data?.investigation_id as string | undefined;
      if (!investigationId) {
        throw new Error("Missing investigation id in server response");
      }
      router.push(`/dashboard/gap-investigations/${investigationId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      {loadError ? <p role="alert" className="text-[12px] text-[color:var(--color-danger-text)]">{loadError}</p> : saved.primary ? (
        <Link href={`/dashboard/gap-investigations/${saved.primary.id}`} className="text-[12px] font-medium underline">
          {saved.primary.status === "active" ? "Continue investigation" : "View investigation"}
        </Link>
      ) : <button
        onClick={start}
        disabled={busy}
        className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)] disabled:opacity-50"
      >
        {busy ? "Starting…" : "Investigate this gap"}
      </button>}
      {!loadError && saved.history.length > 0 && (
        <details className="mt-2 text-[12px]">
          <summary>Investigation history ({saved.history.length})</summary>
          <ul className="mt-1 space-y-1">
            {saved.history.map(row => <li key={row.id}>
              <Link className="underline" href={`/dashboard/gap-investigations/${row.id}`}>
                {row.created_at} · {row.status} · {row.id.slice(0, 8)}
              </Link>
            </li>)}
          </ul>
        </details>
      )}
      {error && (
        <div role="alert" className="mt-1 text-[12px] text-[color:var(--color-danger-text)]">
          {error}
        </div>
      )}
    </div>
  );
}
