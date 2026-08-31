import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/app/components/ui/PageHeader";
import Badge, { type BadgeVariant } from "@/app/components/ui/Badge";
import MetaStrip from "@/app/components/ui/MetaStrip";
import EmptyState from "@/app/components/ui/EmptyState";

type PageProps = {
  searchParams: Promise<{ all?: string }>;
};

const VERDICT_SCORE: Record<string, number> = {
  "Below Bar": 1,
  Borderline: 2,
  "Strong Hire": 3,
};

function verdictVariant(verdict: string | undefined | null): BadgeVariant {
  if (verdict === "Strong Hire") return "success";
  if (verdict === "Borderline") return "caution";
  if (verdict === "Below Bar") return "danger";
  return "neutral";
}

export default async function HistoryPage({ searchParams }: PageProps) {
  const { all } = await searchParams;
  const showAll = all === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const activeProfile = await resolveActiveCareerProfile(supabase, user.id);

  const { data: analyses, error } = await supabase
    .from("analyses")
    .select("id, summary, created_at, raw_json")
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfile.id)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <>
        <PageHeader title="History" description="Something went wrong loading your history." />
        <pre className="bg-[color:var(--color-surface-elevated)] rounded-[6px] p-4 whitespace-pre-wrap text-[13px]">
          {JSON.stringify(error, null, 2)}
        </pre>
      </>
    );
  }

  const list = analyses ?? [];
  const totalAnalyses = list.length;
  const visibleAnalyses = showAll ? list : list.slice(0, 5);

  // Recent trend — moved here from Overview. Compares the two most recent
  // verdicts. Present only when we actually have two verdicts to compare.
  const verdicts = list
    .map((a) => (a.raw_json as { core_verdict?: string } | null)?.core_verdict)
    .filter((v): v is string => typeof v === "string" && v in VERDICT_SCORE);
  const current = verdicts[0];
  const previous = verdicts[1];
  let trendLabel: string | null = null;
  if (current && previous) {
    const cur = VERDICT_SCORE[current];
    const prev = VERDICT_SCORE[previous];
    if (cur > prev) trendLabel = "Improving";
    else if (cur < prev) trendLabel = "Mixed";
    else trendLabel = "Stable";
  }

  return (
    <>
      <PageHeader
        title="History"
        description="Every analysis you've run under this career direction, newest first."
      />

      {trendLabel && (
        <MetaStrip
          items={[
            { label: "Previous", value: previous },
            { label: "Current", value: current },
            { label: "Trend", value: trendLabel },
          ]}
        />
      )}

      {totalAnalyses === 0 && (
        <EmptyState
          title="No analyses yet"
          description="Run your first analysis from a target role to start building history."
        />
      )}

      {visibleAnalyses.length > 0 && (
        <div className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-border-subtle)] overflow-hidden">
          {visibleAnalyses.map((a) => {
            const verdict = (a.raw_json as { core_verdict?: string } | null)
              ?.core_verdict;
            return (
              <Link
                key={a.id}
                href={`/dashboard/${a.id}`}
                className="block px-4 py-3 hover:bg-[color:var(--color-surface-elevated)] transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] uppercase tracking-[0.03em] text-[color:var(--color-text-muted)] whitespace-nowrap">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                      {verdict && (
                        <Badge variant={verdictVariant(verdict)}>
                          {verdict}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[14px] text-[color:var(--color-text-primary)] line-clamp-2">
                      {a.summary || "No summary"}
                    </div>
                  </div>
                  <span className="text-[color:var(--color-text-muted)] mt-1" aria-hidden>
                    →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!showAll && totalAnalyses > 5 && (
        <div className="text-center">
          <Link
            href="?all=1"
            className="inline-block rounded-[6px] border border-[color:var(--color-border-standard)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
          >
            Show all analyses ({totalAnalyses})
          </Link>
        </div>
      )}
    </>
  );
}
