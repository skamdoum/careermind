import Link from "next/link";
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
          description="This analysis is not available for the active job search."
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

  // Post-analysis "What's next?" — only for early-stage users. Counts
  // are goal-scoped so the guidance is meaningful for the user's own
  // workflow, not global to their whole account.
  const goalIdForNext = analysis.career_goal_id as string | null;
  let nextGoalAnalysesCount = 0;
  let nextGoalJobsCount = 0;
  let firstUnanalyzedJobId: string | null = null;
  if (goalIdForNext) {
    const [analysesAgg, jobsAgg, unanalyzedJobs] = await Promise.all([
      supabase
        .from("analyses")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfile.id)
        .eq("career_goal_id", goalIdForNext),
      supabase
        .from("job_descriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfile.id)
        .eq("career_goal_id", goalIdForNext),
      // Find the newest job under this goal that isn't the one we
      // just analyzed. We deep-link to it as the "next role" CTA.
      supabase
        .from("job_descriptions")
        .select("id")
        .eq("user_id", user.id)
        .eq("career_profile_id", activeProfile.id)
        .eq("career_goal_id", goalIdForNext)
        .neq("id", analysis.job_description_id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    nextGoalAnalysesCount = analysesAgg.count ?? 0;
    nextGoalJobsCount = jobsAgg.count ?? 0;
    firstUnanalyzedJobId =
      (unanalyzedJobs.data?.id as string | undefined) ?? null;
  }

  // Show guidance for early-stage users only. Suppress once the user
  // has run a handful of analyses under this goal.
  const NEXT_CARD_MAX_ANALYSES = 4;
  const showNextCard =
    !!goalIdForNext && nextGoalAnalysesCount <= NEXT_CARD_MAX_ANALYSES;

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

      {showNextCard && (
        <WhatsNext
          goalId={goalIdForNext!}
          analysesCount={nextGoalAnalysesCount}
          jobsCount={nextGoalJobsCount}
          nextUnanalyzedJobId={firstUnanalyzedJobId}
        />
      )}
    </div>
  );
}

function WhatsNext({
  goalId,
  analysesCount,
  jobsCount,
  nextUnanalyzedJobId,
}: {
  goalId: string;
  analysesCount: number;
  jobsCount: number;
  nextUnanalyzedJobId: string | null;
}) {
  const hasAnotherRole = nextUnanalyzedJobId !== null;

  // 3 states, no icons, using the standard info-tinted Card so this
  // reads as guidance, not a form.
  let title: string;
  let body: string;
  let ctas: { label: string; href: string; primary?: boolean }[];

  if (analysesCount >= 2) {
    // Just crossed the patterns threshold — or is past it. Overview
    // + Strategy just became fully useful; Action Plan has been
    // populated since analysis #1, so we don't frame it as newly
    // unlocked here.
    title = "You've unlocked cross-role patterns and Strategy";
    body =
      "You now have enough analyses for CareerMind to identify recurring signals and gaps across your target roles. Overview and Strategy just became fully available.";
    ctas = [
      { label: "View Overview", href: "/dashboard", primary: true },
      { label: "View Strategy", href: "/dashboard/strategy-v2" },
    ];
  } else if (hasAnotherRole) {
    // Exactly 1 analysis in this goal, and there's already another
    // role sitting there ready to analyze.
    title = "One down. Analyze one more to unlock patterns and Strategy.";
    body =
      "Your first evaluation is useful on its own and your Action Plan is already populated. Recurring patterns and Strategy appear once at least 2 target roles under this goal are analyzed.";
    ctas = [
      {
        label: "Analyze another role",
        href: `/dashboard/goals/${goalId}/jobs/${nextUnanalyzedJobId}`,
        primary: true,
      },
      {
        label: "Back to career goal",
        href: `/dashboard/goals/${goalId}`,
      },
    ];
  } else {
    // Exactly 1 analysis, no other roles under this goal.
    title = "Add another target role to unlock patterns";
    body =
      "You've analyzed your first role and your Action Plan is populated. Add a second target role so CareerMind has enough analyses to identify recurring patterns and build Strategy.";
    ctas = [
      {
        label: "Add another target role",
        href: `/dashboard/goals/${goalId}/jobs/new`,
        primary: true,
      },
      {
        label: "Back to career goal",
        href: `/dashboard/goals/${goalId}`,
      },
    ];
  }

  // Suppress on the very first render if jobsCount is 0 (shouldn't
  // happen — the analysis has a job — but defensive).
  if (jobsCount === 0) return null;

  return (
    <Card intent="info" padding="lg">
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80">
          What&apos;s next
        </div>
        <div className="text-[16px] font-semibold text-[color:var(--color-text-primary)]">
          {title}
        </div>
        <p className="text-[14px] leading-[1.6] text-[color:var(--color-text-primary)]">
          {body}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {ctas.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={
                c.primary
                  ? "inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
                  : "inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
              }
            >
              {c.label}
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
}
