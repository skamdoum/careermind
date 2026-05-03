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

const TASK_TEMPLATES: Record<string, string[]> = {
  "Strategy & roadmap": [
    "Draft a 1-page roadmap covering 3 strategic bets and trade-offs",
    "Write a strategy memo aligning OKRs to a 12-month vision",
    "Map current initiatives to roadmap themes and surface gaps",
  ],
  "AI / ML": [
    "Document one AI/ML project with a measurable business outcome",
    "Outline an AI use case in your current product domain",
    "Refresh resume to highlight AI/ML exposure or initiatives",
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

function actionsFor(label: string): string[] {
  if (TASK_TEMPLATES[label]) return TASK_TEMPLATES[label];
  return [
    `Outline a concrete plan to address: ${label}`,
    `Draft a 1-page case study showing impact on: ${label}`,
    `Identify 2 past examples that demonstrate: ${label}`,
  ];
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
