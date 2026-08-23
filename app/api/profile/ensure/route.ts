import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: existing } = await supabase
      .from("profiles")
      .select("id, active_career_profile_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from("profiles").insert({
        id: user.id,
        email: user.email,
      });

      if (error) {
        throw error;
      }
    }

    const { data: cpExisting } = await supabase
      .from("career_profiles")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_default", true)
      .maybeSingle();

    let defaultProfileId = cpExisting?.id ?? null;

    if (!defaultProfileId) {
      const { data: created, error: createErr } = await supabase
        .from("career_profiles")
        .insert({
          user_id: user.id,
          name: "My career direction",
          is_default: true,
        })
        .select("id")
        .single();

      if (createErr) {
        throw createErr;
      }
      defaultProfileId = created.id;
    }

    if (defaultProfileId && !existing?.active_career_profile_id) {
      await supabase
        .from("profiles")
        .update({ active_career_profile_id: defaultProfileId })
        .eq("id", user.id);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to ensure profile" },
      { status: 500 }
    );
  }
}
