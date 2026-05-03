import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    const recommended_focus = Array.from(
      new Set(top_gaps.map((g) => g.name.trim()).filter(Boolean))
    ).slice(0, 3);

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