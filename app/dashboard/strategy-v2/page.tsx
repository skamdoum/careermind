import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";
import StrategyNarrativeClient from "./strategy-narrative-client";
import PageHeader from "@/app/components/ui/PageHeader";
import EmptyState from "@/app/components/ui/EmptyState";

function StrategyEmpty({ analysesCount }: { analysesCount: number }) {
  const description =
    analysesCount === 0
      ? "Strategy is built from the patterns across your analyses — positioning, narrative, where to focus vs. where to avoid. Run at least 2 analyses on target roles under a career goal to see yours."
      : analysesCount === 1
      ? "You've analyzed 1 target role — one more unlocks the cross-role patterns Strategy is built from. Head to your career goal to analyze the next one."
      : "You have analyses on file but CareerMind couldn't extract enough signal to build Strategy yet. Try analyzing another role.";
  return (
    <div className="mx-auto max-w-[48rem] space-y-8">
      <PageHeader
        title="Strategy"
        description="Where you're positioned, where to focus, and the story to tell — built from the patterns across your analyses."
      />
      <EmptyState
        title="Strategy appears once you've analyzed 2+ target roles"
        description={description}
        action={
          <Link
            href="/dashboard/goals"
            className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
          >
            Go to your career goal
          </Link>
        }
      />
    </div>
  );
}

const KEYWORD_GROUPS: { label: string; keywords: string[] }[] = [
  { label: "Strategy & roadmap", keywords: ["strategy", "roadmap"] },
  { label: "AI / ML", keywords: ["ai", "ml", "machine learning", "artificial intelligence"] },
];

const FILLER_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "but", "by", "evidence", "for", "from",
  "in", "is", "it", "its", "no", "not", "of", "on", "or", "the", "to", "with",
]);

function simplifyFallback(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const filtered = words.filter((w) => !FILLER_WORDS.has(w.toLowerCase()));
  const kept = filtered.length > 0 ? filtered : words;
  return kept.slice(0, 5).join(" ");
}

function focusLabelFor(name: string): string {
  const normalized = name.trim().toLowerCase();
  const tokens = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  for (const group of KEYWORD_GROUPS) {
    for (const kw of group.keywords) {
      const lowerKw = kw.toLowerCase();
      const matched = lowerKw.includes(" ")
        ? normalized.includes(lowerKw)
        : tokens.has(lowerKw);
      if (matched) return group.label;
    }
  }
  return simplifyFallback(name);
}

type Item = { name: string; count: number };

export default async function StrategyV2Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const activeProfile = await resolveActiveCareerProfile(supabase, user.id);

  const { data: analyses } = await supabase
    .from("analyses")
    .select("raw_json")
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfile.id);

  const gapCounts: Record<string, number> = {};
  const signalCounts: Record<string, number> = {};

  if (analyses) {
    for (const a of analyses) {
      const raw = a.raw_json;
      if (!raw) continue;
      raw.gaps?.forEach((g: any) => {
        const key = g.gap_title;
        gapCounts[key] = (gapCounts[key] || 0) + 1;
      });
      raw.signals?.forEach((s: any) => {
        if (s.score >= 4) {
          const key = s.signal_name;
          signalCounts[key] = (signalCounts[key] || 0) + 1;
        }
      });
    }
  }

  const top_gaps: Item[] = Object.entries(gapCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  const top_signals: Item[] = Object.entries(signalCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  const focusCounts: Record<string, number> = {};
  for (const [rawName, count] of Object.entries(gapCounts)) {
    const trimmed = String(rawName).trim();
    if (!trimmed) continue;
    const label = focusLabelFor(trimmed);
    focusCounts[label] = (focusCounts[label] || 0) + count;
  }
  const recommended_focus: string[] = Object.entries(focusCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label);

  const top_signal = top_signals[0] || null;
  const top_gap = top_gaps[0] || null;
  const hasData = !!(top_signal && top_gap);
  const analysesCount = analyses?.length ?? 0;

  // Not enough evidence yet — render a real empty state, not
  // "Run more analyses to X" placeholder prose.
  if (!hasData) {
    return (
      <StrategyEmpty analysesCount={analysesCount} />
    );
  }

  const positioning = `Position yourself around your strength in ${top_signal!.name} — that's your most credible differentiator right now. Until your ${top_gap!.name} story strengthens, frame those questions around active progress rather than past depth.`;

  const whereToFocus: string[] = [
    `Roles where ${top_signal!.name} is a headline competency, not a side requirement`,
    "Teams with mature strategy frameworks where you can plug in execution depth",
    "Companies that hire ICs into senior tracks based on shipping outcomes",
  ];

  const whereToAvoid: string[] = [
    `Roles that demand ${top_gap!.name} as a day-1 expectation`,
    recommended_focus[0]
      ? `Senior roles where ${recommended_focus[0]} ownership is non-negotiable upfront`
      : "Senior strategy roles before you have stronger evidence on your top gap",
    "Generalist mandates where you can't lead with your strongest signal",
  ];

  const tradeoffs: string[] = [
    `Lead with ${top_signal!.name} examples; foreground outcomes, not the process behind them`,
    `For ${top_gap!.name} questions: acknowledge briefly, then pivot to your active growth plan`,
    recommended_focus[0]
      ? `Demonstrate awareness and direction on ${recommended_focus[0]} rather than claiming senior-level ownership`
      : "Acknowledge growth areas without overstating depth",
    "Anchor every story in measurable impact, not job titles or team size",
  ];

  const narrative =
    recommended_focus.length >= 2
      ? `"I'm a PM with a strong track record of ${top_signal!.name}, and I'm now investing deliberately in ${recommended_focus[0]} and ${recommended_focus[1]}. My next move is into a senior role where I can pair execution depth with broader ownership."`
      : `"I'm a PM with a strong track record of ${top_signal!.name}, and I'm actively closing the gap on ${top_gap!.name}. My next move is into a senior role where I can pair execution depth with broader ownership."`;

  const risks: string[] = [
    `Being typecast based on your ${top_signal!.name} strength when you want broader scope`,
    `Losing senior loops on the ${top_gap!.name} bar before you get to showcase your strengths`,
    "Underselling adjacent skills that don't show up in your aggregated signal data",
  ];

  return (
    <StrategyNarrativeClient
      fallback={{ positioning, whereToFocus, whereToAvoid, tradeoffs, narrative, risks }}
    />
  );
}
