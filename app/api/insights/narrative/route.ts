import { NextResponse } from "next/server";
import OpenAI from "openai";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";
import { createHash } from "crypto";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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

const EMPTY_NARRATIVE = {
  career_summary: "",
  coaching_insight: "",
  recommended_focus: "",
};

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const activeProfile = await resolveActiveCareerProfile(supabase, user.id);

    const { data: analyses } = await supabase
      .from("analyses")
      .select("raw_json")
      .eq("user_id", user.id)
      .eq("career_profile_id", activeProfile.id);

    if (!analyses || analyses.length === 0) {
      return NextResponse.json({ success: true, data: EMPTY_NARRATIVE });
    }

    const gapCounts: Record<string, number> = {};
    const signalCounts: Record<string, number> = {};

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

    const top_signal = top_signals[0] || null;
    const top_gap = top_gaps[0] || null;

    if (!top_gap || !top_signal) {
      return NextResponse.json({ success: true, data: EMPTY_NARRATIVE });
    }

    const inputPayload = {
      top_signal,
      top_gap,
      top_signals,
      top_gaps,
      recommended_focus,
      total_analyses: analyses.length,
    };

    const source_hash = createHash("sha256")
      .update(JSON.stringify(inputPayload))
      .digest("hex");

    const { data: cachedRow } = await supabase
      .from("insight_narratives")
      .select("career_summary, coaching_insight, recommended_focus")
      .eq("user_id", user.id)
      .eq("source_hash", source_hash)
      .maybeSingle();

    if (cachedRow) {
      return NextResponse.json({
        success: true,
        data: {
          career_summary: cachedRow.career_summary,
          coaching_insight: cachedRow.coaching_insight,
          recommended_focus: cachedRow.recommended_focus,
        },
        cached: true,
      });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: `You are CareerMind, a senior PM career coach.

Your task: write narrative-only fields based on aggregated insights about a Product Manager candidate. You generate text only — never structural data.

Tone: direct, professional, coaching-oriented. No fluff. No hedging.

Hard rules:
- Always speak directly to the user using "you" / "your". Never use "this candidate", "the candidate", or any third-person framing.
- Mention the top_signal name at most once across all fields.
- Mention the top_gap name at most once across all fields.
- Do not invent experience, projects, employers, or metrics not present in the input.
- Do not contradict counts, scores, or labels in the input.
- Do not repeat the same idea across fields.
- Avoid broad labels (e.g. "well-rounded PM", "senior leader") unless they tie directly to the user's top_signal or top_gap.
- career_summary must align with recommended_focus and reference its items in the same priority order.
- career_summary: exactly 1 sentence that does all of the following:
  (a) names the user's current positioning, grounded in top_signal,
  (b) names the main blocker, grounded in top_gap,
  (c) calls out the top 1–2 strategy priorities from recommended_focus, in order.
  Style anchor:
  "You are positioned as an execution-focused PM with strong cross-functional delivery, but your path to stronger senior roles depends on proving strategy and roadmap ownership first, then strengthening AI/ML product credibility."
- coaching_insight: 2 to 3 sentences. Explain why the top gap matters for senior PM hiring decisions. Reference the gap concept at most once.
- recommended_focus: exactly 1 sentence. Phrase as a prioritized directive drawn from recommended_focus items in the given order (e.g. "Prioritize X first, then Y").`,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `INPUT DATA (use as grounding facts only; do not echo as JSON):\n${JSON.stringify(inputPayload, null, 2)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "insights_narrative",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              career_summary: { type: "string" },
              coaching_insight: { type: "string" },
              recommended_focus: { type: "string" },
            },
            required: ["career_summary", "coaching_insight", "recommended_focus"],
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text);

    try {
      await supabase.from("insight_narratives").insert({
        user_id: user.id,
        source_hash,
        career_summary: parsed.career_summary,
        coaching_insight: parsed.coaching_insight,
        recommended_focus: parsed.recommended_focus,
      });
    } catch (insertErr) {
      console.error("INSIGHTS NARRATIVE CACHE INSERT ERROR:", insertErr);
    }

    return NextResponse.json({
      success: true,
      data: {
        career_summary: parsed.career_summary,
        coaching_insight: parsed.coaching_insight,
        recommended_focus: parsed.recommended_focus,
      },
      cached: false,
    });
  } catch (err) {
    console.error("INSIGHTS NARRATIVE ERROR:", err);
    return NextResponse.json({ success: false, error: "Failed to generate narrative" }, { status: 500 });
  }
}
