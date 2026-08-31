import { redirect } from "next/navigation";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/app/components/ui/PageHeader";
import SectionHeader from "@/app/components/ui/SectionHeader";
import Card from "@/app/components/ui/Card";
import MetaStrip from "@/app/components/ui/MetaStrip";
import VerdictHero from "@/app/components/ui/VerdictHero";
import SignalRow from "@/app/components/ui/SignalRow";
import GapRow from "@/app/components/ui/GapRow";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AnalysisDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const activeProfile = await resolveActiveCareerProfile(supabase, user.id);

  const { data: analysis, error } = await supabase
    .from("analyses")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfile.id)
    .single();

  if (error || !analysis) {
    return (
      <div className="mx-auto max-w-[48rem]">
        <PageHeader
          title="Analysis not found"
          description="This analysis is not available for the active career profile."
        />
      </div>
    );
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("analysis_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const data = analysis.raw_json as {
    core_verdict?: string;
    positioning_summary?: string;
    signals?: Array<{
      signal_name?: string;
      name?: string;
      score?: number;
      rationale?: string;
      reasoning?: string;
      evidence?: string[];
    }>;
    gaps?: Array<{
      gap_title?: string;
      title?: string;
      gap_description?: string;
      description?: string;
      recommended_fix?: string;
      severity?: "High" | "Medium" | "Low" | string;
    }>;
    plan?: { next_best_action?: string };
    company_name?: string;
  } | null;

  const verdict = data?.core_verdict;
  const positioningSummary = analysis.summary || data?.positioning_summary;
  const nextBestAction = plan?.next_best_action || data?.plan?.next_best_action;

  const shortId =
    typeof analysis.id === "string" ? analysis.id.slice(0, 8) : analysis.id;
  const createdLabel = analysis.created_at
    ? new Date(analysis.created_at).toLocaleDateString()
    : "—";

  return (
    <div className="mx-auto max-w-[48rem] space-y-8">
      <PageHeader
        eyebrow={`Analysis #${shortId}`}
        title="Analysis"
        description="Review your fit, biggest gaps, and the highest-leverage next steps."
      />

      <MetaStrip
        items={[
          { label: "Created", value: createdLabel },
          {
            label: "Resume",
            value: analysis.resume_name || "Latest uploaded resume",
          },
          {
            label: "Target job",
            value:
              analysis.job_title ||
              data?.company_name ||
              "Pasted job description",
          },
        ]}
      />

      <VerdictHero verdict={verdict} summary={positioningSummary} />

      {nextBestAction && (
        <Card intent="info" padding="lg">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80">
              Job-specific guidance
            </div>
            <p className="text-[15px] leading-[1.6] text-[color:var(--color-text-primary)]">
              {nextBestAction}
            </p>
          </div>
        </Card>
      )}

      <section className="space-y-4">
        <SectionHeader
          title="Strength signals"
          meta={
            data?.signals?.length
              ? `${data.signals.length} signals`
              : undefined
          }
        />

        {data?.signals?.length ? (
          <div className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-border-subtle)] overflow-hidden">
            {data.signals.map((s, i) => (
              <SignalRow
                key={i}
                name={s.signal_name || s.name}
                score={typeof s.score === "number" ? s.score : undefined}
                rationale={s.rationale || s.reasoning}
                evidence={s.evidence}
              />
            ))}
          </div>
        ) : (
          <div className="text-[13px] text-[color:var(--color-text-muted)]">
            No strength signals were returned for this analysis.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Key gaps"
          meta={data?.gaps?.length ? `${data.gaps.length} gaps` : "0 gaps"}
        />

        {data?.gaps && data.gaps.length > 0 ? (
          <div className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-border-subtle)] overflow-hidden">
            {data.gaps.map((g, i) => (
              <GapRow
                key={i}
                title={g.gap_title || g.title || `Gap ${i + 1}`}
                description={g.gap_description || g.description}
                severity={g.severity}
                recommendedFix={g.recommended_fix}
              />
            ))}
          </div>
        ) : (
          <div className="text-[13px] text-[color:var(--color-text-muted)]">
            No material gaps for this role.
          </div>
        )}
      </section>
    </div>
  );
}
