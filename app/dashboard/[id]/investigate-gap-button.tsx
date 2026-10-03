"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  gapId: string;
  className?: string;
};

// Small client button — starts a new investigation from the given seed
// gap and redirects to the investigation page. Kept isolated so the
// analysis page can stay a server component.
export default function InvestigateGapButton({ gapId, className }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
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
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        onClick={start}
        disabled={busy}
        className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)] disabled:opacity-50"
      >
        {busy ? "Starting…" : "Investigate this gap"}
      </button>
      {error && (
        <div className="mt-1 text-[12px] text-[color:var(--color-danger-text)]">
          {error}
        </div>
      )}
    </div>
  );
}
