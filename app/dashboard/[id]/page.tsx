import { redirect } from "next/navigation";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/app/components/ui/PageHeader";
import SectionHeader from "@/app/components/ui/SectionHeader";
import Card from "@/app/components/ui/Card";
import MetaStrip from "@/app/components/ui/MetaStrip";
import VerdictHero from "@/app/components/ui/VerdictHero";
import Badge from "@/app/components/ui/Badge";

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
          <div className="space-y-3">
            {data.signals.map((s, i) => {
              const score = Number(s.score ?? 0);
              const scoreVariant =
                score >= 4 ? "success" : score === 3 ? "caution" : "neutral";
              return (
                <Card key={i} padding="md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[15px] font-semibold text-[color:var(--color-text-primary)] min-w-0">
                      {s.signal_name || s.name}
                    </div>
                    <Badge variant={scoreVariant}>{score}/5</Badge>
                  </div>

                  <p className="text-[14px] leading-[1.6] text-[color:var(--color-text-secondary)] mt-2">
                    {s.rationale || s.reasoning}
                  </p>

                  {s.evidence && s.evidence.length > 0 && (
                    <ul className="list-disc pl-5 mt-3 text-[13px] text-[color:var(--color-text-secondary)] space-y-1">
                      {s.evidence.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
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
          <div className="space-y-3">
            {data.gaps.map((g, i) => {
              const sev = String(g.severity || "").toLowerCase();
              const dotColor =
                sev === "high"
                  ? "bg-[color:var(--color-danger-text)]"
                  : sev === "medium"
                  ? "bg-[color:var(--color-caution-text)]"
                  : "bg-[color:var(--color-text-muted)]";
              return (
                <Card key={i} padding="md">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`}
                      aria-label={`Severity ${g.severity || "unspecified"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-[color:var(--color-text-primary)]">
                        {g.gap_title || g.title || `Gap ${i + 1}`}
                      </div>
                      <p className="text-[14px] leading-[1.6] text-[color:var(--color-text-secondary)] mt-1">
                        {g.gap_description || g.description}
                      </p>
                      {g.recommended_fix && (
                        <p className="text-[13px] text-[color:var(--color-text-muted)] mt-2">
                          <span className="font-semibold text-[color:var(--color-text-secondary)]">
                            Suggested fix ·{" "}
                          </span>
                          {g.recommended_fix}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
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
