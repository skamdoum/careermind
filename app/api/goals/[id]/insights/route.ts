import { NextResponse } from "next/server";
import { getGoalCrossJobInsights } from "@/lib/db/goal-insights";

type RouteProps = {
  params: Promise<{ id: string }>;
};

function errorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message ? error.message : fallback;

  let status = 500;
  if (message === "Unauthorized") status = 401;
  else if (message === "Career goal not found") status = 404;

  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(_req: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    const data = await getGoalCrossJobInsights(id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to load cross-job insights");
  }
}
