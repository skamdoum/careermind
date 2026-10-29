import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { readSeedPlan } from "@/lib/action-plans/read-seed-plan";
import { AssessmentError } from "@/lib/gap-investigation/plan-recommendation";
import { evaluatePlanRecommendation } from "@/lib/gap-investigation/evaluate-plan-recommendation";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    // Body-supplied plan IDs, evidence, status and profile IDs are never accepted.
    const input = await readSeedPlan(client, user.id, id);
    const recommendation = await evaluatePlanRecommendation(input);
    const fresh = await readSeedPlan(client, user.id, id);
    const freshHash = createHash("sha256").update(JSON.stringify(fresh)).digest("hex");
    if (freshHash !== recommendation.source_hash) throw new AssessmentError("assessment_stale", "The evidence or plan changed during the check. Please check again.", 409);
    return NextResponse.json({ success: true, data: recommendation }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AssessmentError) return NextResponse.json({ success: false, error: error.code, message: error.message }, { status: error.status });
    // Do not log model content, evidence, credentials or raw provider errors.
    return NextResponse.json({ success: false, error: "assessment_unavailable", message: "The assessment is unavailable. Please try again later." }, { status: 503 });
  }
}
