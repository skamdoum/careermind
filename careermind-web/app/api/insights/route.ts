import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: analyses } = await supabase
      .from("analyses")
      .select("raw_json")
      .eq("user_id", user.id);

    if (!analyses || analyses.length === 0) {
      return NextResponse.json({ insights: null });
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

    const topGap = Object.entries(gapCounts).sort((a, b) => b[1] - a[1])[0];
    const topSignal = Object.entries(signalCounts).sort((a, b) => b[1] - a[1])[0];

    return NextResponse.json({
      insights: {
        top_gap: topGap ? { name: topGap[0], count: topGap[1] } : null,
        top_signal: topSignal ? { name: topSignal[0], count: topSignal[1] } : null,
        total_analyses: analyses.length,
      },
    });
  } catch (err) {
    console.error("INSIGHTS ERROR:", err);
    return NextResponse.json({ error: "Failed to load insights" }, { status: 500 });
  }
}