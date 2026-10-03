import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/app/components/ui/PageHeader";
import { loadInvestigationBundle } from "@/lib/db/gap-investigations";
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

  const bundle = await loadInvestigationBundle(id, user.id);

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

      <InvestigationClient initialBundle={bundle} />
    </div>
  );
}
