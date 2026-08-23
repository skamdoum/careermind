import { NextResponse } from "next/server";
import { resolveActiveCareerProfile } from "@/lib/db/career-profiles";
import { createClient } from "@/lib/supabase/server";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { status } = body;

    const allowedStatuses = ["not_started", "in_progress", "done"];

    if (!allowedStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: "Invalid status" },
        { status: 400 }
      );
    }

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

    const activeProfile = await resolveActiveCareerProfile(supabase, user.id);

    const { data: task, error: taskErr } = await supabase
      .from("plan_tasks")
      .select("id, plan_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (taskErr) throw taskErr;
    if (!task) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    const { data: plan, error: planErr } = await supabase
      .from("plans")
      .select("analysis_id")
      .eq("id", task.plan_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (planErr) throw planErr;
    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    const { data: analysis, error: analysisErr } = await supabase
      .from("analyses")
      .select("id")
      .eq("id", plan.analysis_id)
      .eq("user_id", user.id)
      .eq("career_profile_id", activeProfile.id)
      .maybeSingle();

    if (analysisErr) throw analysisErr;
    if (!analysis) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 }
      );
    }

    // Ownership + active-profile membership verified above. Perform the update
    // via the authenticated server client — plan_tasks has an owner UPDATE RLS
    // policy that enforces user_id = auth.uid().
    const { data, error } = await supabase
      .from("plan_tasks")
      .update({ status })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error("Task update error:", error);

    return NextResponse.json(
      { success: false, error: error?.message || "Failed to update task" },
      { status: 500 }
    );
  }
}
