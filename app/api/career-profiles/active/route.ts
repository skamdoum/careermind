import { NextResponse } from "next/server";
import { getActiveCareerProfile } from "@/lib/db/career-profiles";

function errorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  const status = message === "Unauthorized" ? 401 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET() {
  try {
    const data = await getActiveCareerProfile();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to load active career profile");
  }
}
