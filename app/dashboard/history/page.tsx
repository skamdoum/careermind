import { redirect } from "next/navigation";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/app/components/ui/PageHeader";
import MetaStrip from "@/app/components/ui/MetaStrip";
import HistoryList from "./HistoryList";

type PageProps = {
  searchParams: Promise<{ all?: string }>;
};

const VERDICT_SCORE: Record<string, number> = {
  "Below Bar": 1,
  Borderline: 2,
  "Strong Hire": 3,
};

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
        <PageHeader
          title="History"
          description="Something went wrong loading your history."
        />
        <pre className="bg-[color:var(--color-surface-elevated)] rounded-[6px] p-4 whitespace-pre-wrap text-[13px]">
          {JSON.stringify(error, null, 2)}
        </pre>
      </>
    );
  }

  const list = analyses ?? [];
  const totalAnalyses = list.length;
  const visibleAnalyses = showAll ? list : list.slice(0, 5);

  // Recent trend — compares the two most recent verdicts. Present only
  // when we actually have two verdicts to compare.
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

  const rowsForClient = visibleAnalyses.map((a) => ({
    id: a.id as string,
    summary: (a.summary as string | null) ?? null,
    created_at: a.created_at as string,
    verdict:
      (a.raw_json as { core_verdict?: string } | null)?.core_verdict ?? null,
  }));

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

      <HistoryList
        analyses={rowsForClient}
        showAll={showAll}
        totalAnalyses={totalAnalyses}
      />
    </>
  );
}
