import { NextResponse } from "next/server";
import { getCareerGoalById } from "@/lib/db/career-goals";

type RouteProps = {
  params: Promise<{ id: string }>;
};

function errorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  const status = message === "Unauthorized" ? 401 : 500;

  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(_req: Request, { params }: RouteProps) {
  try {
    const { id } = await params;

    const data = await getCareerGoalById(id);

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Career goal not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to fetch career goal");
  }
}
