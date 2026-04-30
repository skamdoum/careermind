import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";

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
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("plan_tasks")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      task: data,
    });
  } catch (error: any) {
    console.error("Task update error:", error);

    return NextResponse.json(
      { error: error?.message || "Failed to update task" },
      { status: 500 }
    );
  }
}