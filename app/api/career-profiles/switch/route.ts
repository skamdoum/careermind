import { NextResponse } from "next/server";
import { switchActiveCareerProfile } from "@/lib/db/career-profiles";

function errorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  let status = 500;
  if (message === "Unauthorized") status = 401;
  else if (message === "Job search not found") status = 404;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { id } = body as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, error: "id is required" },
      { status: 400 }
    );
  }

  try {
    const data = await switchActiveCareerProfile(id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to switch job search");
  }
}
