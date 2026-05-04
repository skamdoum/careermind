import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const KEYWORD_GROUPS: { label: string; keywords: string[] }[] = [
  { label: "Strategy & roadmap", keywords: ["strategy", "roadmap"] },
  { label: "AI / ML", keywords: ["ai", "ml", "machine learning", "artificial intelligence"] },
];

const FILLER_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "but", "by", "evidence", "for", "from",
  "in", "is", "it", "its", "no", "not", "of", "on", "or", "the", "to", "with",
]);

type StrategyTask = {
  text: string;
  priority: "P1" | "P2" | "P3";
  impact: "High" | "Medium" | "Low";
  effort: "Low" | "Medium" | "High";
};

const PRIORITY_RANK: Record<StrategyTask["priority"], number> = {
  P1: 1,
  P2: 2,
  P3: 3,
};

function byPriority(a: StrategyTask, b: StrategyTask): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

const TASK_TEMPLATES: Record<string, StrategyTask[]> = {
  "Strategy & roadmap": [
    { text: "Draft a 1-page roadmap with 3 strategic bets, trade-offs, and 6-month milestones", priority: "P1", impact: "High", effort: "Medium" },
    { text: "Write a 500-word strategy memo linking your team's OKRs to a 12-month vision", priority: "P2", impact: "High", effort: "Medium" },
    { text: "Map your 5 most-active initiatives to roadmap themes; flag unfunded gaps", priority: "P3", impact: "Medium", effort: "Low" },
  ],
  "AI / ML": [
    { text: "Document 1 AI/ML project with a measurable revenue or efficiency outcome", priority: "P1", impact: "High", effort: "Medium" },
    { text: "Draft a 1-page AI use case for your product domain, including the success metric", priority: "P2", impact: "Medium", effort: "Low" },
    { text: "Add 2 resume bullets quantifying your AI/ML scope and shipped impact", priority: "P3", impact: "Medium", effort: "Low" },
  ],
};

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

function actionsFor(label: string): StrategyTask[] {
  const tasks: StrategyTask[] = TASK_TEMPLATES[label] ?? [
    { text: `Write a 200-word framing statement of your angle on ${label}`, priority: "P1", impact: "High", effort: "Low" },
    { text: `Pick 1 past project where you drove ${label}; write 3 bullets with metrics`, priority: "P2", impact: "High", effort: "Medium" },
    { text: `Add 1 resume line quantifying impact specifically tied to ${label}`, priority: "P3", impact: "Medium", effort: "Low" },
  ];
  return [...tasks].sort(byPriority);
}

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: analyses } = await supabase
      .from("analyses")
      .select("raw_json")
      .eq("user_id", user.id);

    if (!analyses || analyses.length === 0) {
      return NextResponse.json({
        success: true,
        data: { priorities: [], actions: [] },
      });
    }

    const gapCounts: Record<string, number> = {};

    for (const a of analyses) {
      const raw = a.raw_json;
      if (!raw) continue;
      raw.gaps?.forEach((g: any) => {
        const key = g.gap_title;
        gapCounts[key] = (gapCounts[key] || 0) + 1;
      });
    }

    const focusCounts: Record<string, number> = {};
    for (const [rawName, count] of Object.entries(gapCounts)) {
      const trimmed = String(rawName).trim();
      if (!trimmed) continue;
      const label = focusLabelFor(trimmed);
      focusCounts[label] = (focusCounts[label] || 0) + count;
    }

    const priorities = Object.entries(focusCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label]) => label);

    const actions = priorities.map((priority) => ({
      title: priority,
      tasks: actionsFor(priority),
      impact: "high" as const,
    }));

    return NextResponse.json({
      success: true,
      data: { priorities, actions },
    });
  } catch (err) {
    console.error("STRATEGY ERROR:", err);
    return NextResponse.json({ success: false, error: "Failed to load strategy" }, { status: 500 });
  }
}
