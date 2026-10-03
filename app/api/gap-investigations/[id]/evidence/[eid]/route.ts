import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { UserEvidenceStatus } from "@/lib/db/gap-investigations";

const ALLOWED_STATUS: UserEvidenceStatus[] = [
  "pending",
  "confirmed",
  "edited",
  "rejected",
];

// PATCH /api/gap-investigations/[id]/evidence/[eid]
// Body: { user_status: "confirmed" | "edited" | "rejected", user_edit?: string }
// Updates the user's decision on a single candidate evidence claim.
// Only user_status "confirmed" or "edited" makes the claim count as
// validated evidence — see validatedEvidence() in lib/db/gap-investigations.ts.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; eid: string }> }
) {
  try {
    const { id, eid } = await params;
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

    const body = await req.json().catch(() => ({}));
    const status =
      typeof body?.user_status === "string"
        ? (body.user_status.trim() as UserEvidenceStatus)
        : null;
    const userEdit =
      typeof body?.user_edit === "string" ? body.user_edit.trim() : null;

    if (!status || !ALLOWED_STATUS.includes(status)) {
      return NextResponse.json(
        {
          success: false,
          error: `user_status must be one of ${ALLOWED_STATUS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (status === "edited" && !userEdit) {
      return NextResponse.json(
        {
          success: false,
          error: "user_edit is required when user_status is 'edited'",
        },
        { status: 400 }
      );
    }

    // Verify the parent investigation belongs to the user before touching
    // the evidence row. RLS is the second line of defense.
    const { data: investigation, error: invErr } = await supabase
      .from("gap_investigations")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (invErr) {
      return NextResponse.json(
        { success: false, error: invErr.message },
        { status: 500 }
      );
    }
    if (!investigation) {
      return NextResponse.json(
        { success: false, error: "Investigation not found" },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {
      user_status: status,
      updated_at: new Date().toISOString(),
    };
    if (status === "edited") {
      updates.user_edit = userEdit;
    } else {
      // Clear user_edit when transitioning back to a non-edited status.
      updates.user_edit = null;
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("gap_investigation_evidence")
      .update(updates)
      .eq("id", eid)
      .eq("investigation_id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (upErr || !updated) {
      return NextResponse.json(
        {
          success: false,
          error: upErr?.message || "Evidence not found",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to update evidence";
    console.error("[gap-investigations] evidence PATCH error:", err);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}
