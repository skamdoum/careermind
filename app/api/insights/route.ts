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
      return NextResponse.json({ success: true, data: null });
    }

    const gapCounts: Record<string, number> = {};
    const signalCounts: Record<string, number> = {};

    for (const a of analyses) {
      const data = a.raw_json;

      if (!data) continue;

      // Count gaps
      data.gaps?.forEach((g: any) => {
        const key = g.gap_title;
        gapCounts[key] = (gapCounts[key] || 0) + 1;
      });

      // Count strong signals (score >=4)
      data.signals?.forEach((s: any) => {
        if (s.score >= 4) {
          const key = s.signal_name;
          signalCounts[key] = (signalCounts[key] || 0) + 1;
        }
      });
    }

    const TOP_N = 3;

    const top_gaps = Object.entries(gapCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([name, count]) => ({ name, count }));

    const top_signals = Object.entries(signalCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([name, count]) => ({ name, count }));

    const focusCounts: Record<string, number> = {};
    for (const [rawName, count] of Object.entries(gapCounts)) {
      const trimmed = String(rawName).trim();
      if (!trimmed) continue;
      const label = focusLabelFor(trimmed);
      focusCounts[label] = (focusCounts[label] || 0) + count;
    }

    const recommended_focus = Object.entries(focusCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label]) => label);

    return NextResponse.json({
      success: true,
      data: {
        top_gap: top_gaps[0] || null,
        top_signal: top_signals[0] || null,
        top_gaps,
        top_signals,
        recommended_focus,
        total_analyses: analyses.length,
      },
    });
  } catch (err) {
    console.error("INSIGHTS ERROR:", err);
    return NextResponse.json({ success: false, error: "Failed to load insights" }, { status: 500 });
  }
}