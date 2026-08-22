import { NextResponse } from "next/server";
import {
  createCareerGoal,
  getCareerGoalsByUser,
} from "@/lib/db/career-goals";

function errorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  const status = message === "Unauthorized" ? 401 : 500;

  return NextResponse.json({ success: false, error: message }, { status });
}

function isOptionalString(v: unknown): v is string | null | undefined {
  return v === undefined || v === null || typeof v === "string";
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidOptionalUuid(v: unknown): v is string | null | undefined {
  if (v === undefined || v === null) return true;
  return typeof v === "string" && UUID_REGEX.test(v);
}

export async function GET() {
  try {
    const data = await getCareerGoalsByUser();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to fetch career goals");
  }
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

  const { title, target_level, target_function, primary_resume_id } =
    body as Record<string, unknown>;

  if (typeof title !== "string") {
    return NextResponse.json(
      { success: false, error: "title is required and must be a string" },
      { status: 400 }
    );
  }

  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return NextResponse.json(
      { success: false, error: "title cannot be empty" },
      { status: 400 }
    );
  }

  if (!isOptionalString(target_level)) {
    return NextResponse.json(
      { success: false, error: "target_level must be a string or null" },
      { status: 400 }
    );
  }

  if (!isOptionalString(target_function)) {
    return NextResponse.json(
      { success: false, error: "target_function must be a string or null" },
      { status: 400 }
    );
  }

  if (!isValidOptionalUuid(primary_resume_id)) {
    return NextResponse.json(
      { success: false, error: "primary_resume_id must be a valid UUID or null" },
      { status: 400 }
    );
  }

  try {
    const data = await createCareerGoal({
      title: trimmedTitle,
      target_level: target_level ?? null,
      target_function: target_function ?? null,
      primary_resume_id: primary_resume_id ?? null,
    });

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Failed to create career goal");
  }
}
