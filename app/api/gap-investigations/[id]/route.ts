import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { existingActiveProfile, INITIALIZATION_ERROR } from "@/lib/gap-investigation/saved";
import { loadInvestigationBundle } from "@/lib/db/gap-investigations";

// GET /api/gap-investigations/[id]
// Returns the full investigation bundle (investigation + turns + evidence)
// scoped to the authenticated user.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: userError?.message || "Unauthorized" },
        { status: 401 }
      );
    }

    const profileId = await existingActiveProfile(supabase, user.id);
    const bundle = profileId ? await loadInvestigationBundle(id, user.id, profileId) : null;
    if (!bundle) {
      return NextResponse.json(
        { success: false, error: "Investigation not found" },
        { status: 404 }
      );
    }

    if (!bundle.turns.some(turn => turn.role === "assistant" && turn.turn_index === 0)) {
      return NextResponse.json({ success: false, error: INITIALIZATION_ERROR }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: bundle }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to load investigation";
    console.error("[gap-investigations] GET error:", err);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}
