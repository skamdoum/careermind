import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { existingActiveProfile, INITIALIZATION_ERROR } from "@/lib/gap-investigation/saved";
import PageHeader from "@/app/components/ui/PageHeader";
import { loadInvestigationBundle } from "@/lib/db/gap-investigations";
import type { InvestigationBundle } from "@/lib/db/gap-investigations";
import InvestigationClient from "./investigation-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function GapInvestigationPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let bundle: InvestigationBundle | null;
  try {
    const profileId = await existingActiveProfile(supabase, user.id);
    bundle = profileId ? await loadInvestigationBundle(id, user.id, profileId) : null;
  } catch {
    return (
      <div className="mx-auto max-w-4xl w-full px-6 py-6 space-y-4" role="alert">
        <PageHeader title="Conversation could not be loaded" description="Your saved data has not been changed. Reload this investigation to try again." />
        <a className="text-[13px] underline" href={`/dashboard/gap-investigations/${id}`}>Reload investigation</a>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="mx-auto max-w-4xl w-full px-6 py-6">
        <PageHeader
          title="Investigation not found"
          description="This gap investigation is not available."
        />
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const { investigation } = bundle;
  const gap = investigation.context_snapshot?.gap;
  const target = investigation.context_snapshot?.target;
  const backHref = investigation.seed_analysis_id
    ? `/dashboard/${investigation.seed_analysis_id}`
    : "/dashboard";

  return (
    <div className="mx-auto max-w-4xl w-full px-6 py-6 space-y-6">
      <PageHeader
        eyebrow="Gap investigation"
        title={gap?.gap_title || "Gap"}
        description={gap?.gap_description || undefined}
      />

      <div className="text-[13px] text-[color:var(--color-text-muted)] flex flex-wrap gap-x-4 gap-y-1">
        {target && (
          <span>
            Target: {target.role} · {target.level}
          </span>
        )}
        {gap?.gap_code && <span>Code: {gap.gap_code}</span>}
        <Link href={backHref} className="underline hover:opacity-80">
          Back to analysis
        </Link>
      </div>

      {bundle.turns.some(turn => turn.role === "assistant" && turn.turn_index === 0) ? (
        <InvestigationClient key={investigation.id} initialBundle={bundle} />
      ) : (
        <div role="alert" className="space-y-2 text-[13px]">
          <p>{INITIALIZATION_ERROR}</p>
          <a className="underline" href={`/dashboard/gap-investigations/${id}`}>Reload investigation</a>
        </div>
      )}
    </div>
  );
}
