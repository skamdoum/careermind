import { NextResponse } from "next/server";
import {
  getAnalysesForTargetJob,
  getTargetJobById,
} from "@/lib/db/target-jobs";

type RouteProps = {
  params: Promise<{ id: string; jobId: string }>;
};

function errorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  const status = message === "Unauthorized" ? 401 : 500;

  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(_req: Request, { params }: RouteProps) {
  try {
    const { id: careerGoalId, jobId } = await params;

    const job = await getTargetJobById(jobId);

    if (!job || job.career_goal_id !== careerGoalId) {
      return NextResponse.json(
        { success: false, error: "Target job not found" },
        { status: 404 }
      );
    }

    const data = await getAnalysesForTargetJob(jobId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to fetch analyses");
  }
}
