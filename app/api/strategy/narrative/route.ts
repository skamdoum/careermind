import { NextResponse } from "next/server";
import OpenAI from "openai";
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

const EMPTY_STRATEGY_NARRATIVE = {
  target_positioning: "",
  strategic_direction: "",
  where_to_focus: [],
  where_to_avoid: [],
  positioning_tradeoffs: [],
  narrative_to_tell: "",
  risks: [],
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

    const { data: analyses } = await supabase
      .from("analyses")
      .select("raw_json")
      .eq("user_id", user.id);

    if (!analyses || analyses.length === 0) {
      return NextResponse.json({ success: true, data: EMPTY_STRATEGY_NARRATIVE });
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

    const top_gap = top_gaps[0] || null;
    const top_signal = top_signals[0] || null;

    if (!top_gap || !top_signal) {
      return NextResponse.json({ success: true, data: EMPTY_STRATEGY_NARRATIVE });
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
      .from("strategy_narratives")
      .select("target_positioning, strategic_direction, where_to_focus, where_to_avoid, positioning_tradeoffs, narrative_to_tell, risks")
      .eq("user_id", user.id)
      .eq("source_hash", source_hash)
      .maybeSingle();

    if (cachedRow) {
      return NextResponse.json({
        success: true,
        data: {
          target_positioning: cachedRow.target_positioning,
          strategic_direction: cachedRow.strategic_direction,
          where_to_focus: cachedRow.where_to_focus,
          where_to_avoid: cachedRow.where_to_avoid,
          positioning_tradeoffs: cachedRow.positioning_tradeoffs,
          narrative_to_tell: cachedRow.narrative_to_tell,
          risks: cachedRow.risks,
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
              text: `You are CareerMind, a senior PM career strategist.

Your task: generate a strategic positioning plan for a Product Manager based on aggregated hiring signal data. You produce structured strategy fields — not task lists.

Tone: direct, specific, senior-hiring-level coaching. No fluff. No hedging. No vague advice.

Hard rules:
- Always speak directly to the user using "you" / "your". Never use "this candidate", "the candidate", or third-person framing.
- Do not invent experience, projects, employers, or metrics not present in the input.
- Do not contradict counts or labels in the input.
- Do not repeat the same idea across fields.
- Every bullet must be concrete and actionable — no filler phrases like "consider", "explore", or "think about".
- Mention top_signal.name at most once across all fields.
- Mention top_gap.name at most once across all fields.

Field rules:
- target_positioning: 1 to 2 sentences. Name the specific PM archetype this user is best positioned for right now, grounded in top_signal. Be precise — not "strong PM" but e.g. "execution-focused PM with cross-functional delivery".
- strategic_direction: 1 short paragraph (3 to 4 sentences). Explain the strategic move the user must make in the next 6–12 months. Ground it in recommended_focus priority order. Reference the user's biggest gap without repeating it verbatim.
- where_to_focus: exactly 3 bullets. Each bullet names a specific role type, company stage, or hiring context where this user's profile is currently strongest. Start each bullet with the target type, then explain why it fits.
- where_to_avoid: exactly 3 bullets. Each bullet names a role type, company stage, or hiring context where this user is currently underqualified or misaligned. Be honest and direct.
- positioning_tradeoffs: 3 to 4 bullets. Each bullet names a real trade-off the user must accept or navigate given their current profile — e.g. "Targeting AI-native companies means being held to a higher ML bar you have not yet demonstrated."
- narrative_to_tell: 1 first-person paragraph (3 to 5 sentences). Write it as if the user is speaking in an interview. Ground it in top_signal and recommended_focus. Do not use "I am" as the opening. Do not echo the input data literally.
- risks: 2 to 3 bullets. Each bullet names a specific hiring risk this user faces based on gaps or signal gaps. Each bullet must include what the risk is and a one-line mitigation.`,
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
          name: "strategy_narrative",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              target_positioning: { type: "string" },
              strategic_direction: { type: "string" },
              where_to_focus: {
                type: "array",
                items: { type: "string" },
              },
              where_to_avoid: {
                type: "array",
                items: { type: "string" },
              },
              positioning_tradeoffs: {
                type: "array",
                items: { type: "string" },
              },
              narrative_to_tell: { type: "string" },
              risks: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: [
              "target_positioning",
              "strategic_direction",
              "where_to_focus",
              "where_to_avoid",
              "positioning_tradeoffs",
              "narrative_to_tell",
              "risks",
            ],
          },
        },
      },
    });

    let parsed: any;
    try {
      parsed = JSON.parse(response.output_text);
    } catch (parseErr) {
      console.error("STRATEGY NARRATIVE PARSE ERROR:", parseErr);
      return NextResponse.json({ success: true, data: EMPTY_STRATEGY_NARRATIVE });
    }

    try {
      await supabase.from("strategy_narratives").insert({
        user_id: user.id,
        source_hash,
        target_positioning: parsed.target_positioning,
        strategic_direction: parsed.strategic_direction,
        where_to_focus: parsed.where_to_focus,
        where_to_avoid: parsed.where_to_avoid,
        positioning_tradeoffs: parsed.positioning_tradeoffs,
        narrative_to_tell: parsed.narrative_to_tell,
        risks: parsed.risks,
      });
    } catch (insertErr) {
      console.error("STRATEGY NARRATIVE CACHE INSERT ERROR:", insertErr);
    }

    return NextResponse.json({
      success: true,
      data: {
        target_positioning: parsed.target_positioning,
        strategic_direction: parsed.strategic_direction,
        where_to_focus: parsed.where_to_focus,
        where_to_avoid: parsed.where_to_avoid,
        positioning_tradeoffs: parsed.positioning_tradeoffs,
        narrative_to_tell: parsed.narrative_to_tell,
        risks: parsed.risks,
      },
      cached: false,
    });
  } catch (err) {
    console.error("STRATEGY NARRATIVE ERROR:", err);
    return NextResponse.json({ success: false, error: "Failed to generate strategy narrative" }, { status: 500 });
  }
}
