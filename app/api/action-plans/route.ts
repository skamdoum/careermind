import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { readActionPlans } from "@/lib/action-plans/read";

export async function GET() {
  try {
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const profile = await resolveActiveCareerProfile(client, user.id);
    const data = await readActionPlans(client, user.id, profile.id);
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ success: false, error: "Could not load your saved action plans. Please try again." }, { status: 500 });
  }
}
