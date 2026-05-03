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
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(2);

    const current_verdict = analyses?.[0]?.raw_json?.core_verdict ?? null;
    const previous_verdict = analyses?.[1]?.raw_json?.core_verdict ?? null;

    return NextResponse.json({
      success: true,
      data: { previous_verdict, current_verdict },
    });
  } catch (err) {
    console.error("PROGRESS ERROR:", err);
    return NextResponse.json({ success: false, error: "Failed to load progress" }, { status: 500 });
  }
}
