import { NextResponse } from "next/server";
import {
  deleteCareerGoal,
  getCareerGoalById,
  updateCareerGoal,
} from "@/lib/db/career-goals";

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

function isOptionalString(v: unknown): v is string | null | undefined {
  return v === undefined || v === null || typeof v === "string";
}

function normalizeOptional(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
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

export async function PATCH(req: Request, { params }: RouteProps) {
  const { id } = await params;

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

  const { title, target_level, target_function } = body as Record<
    string,
    unknown
  >;

  const payload: {
    title?: string;
    target_level?: string | null;
    target_function?: string | null;
  } = {};

  if (title !== undefined) {
    if (typeof title !== "string") {
      return NextResponse.json(
        { success: false, error: "title must be a string" },
        { status: 400 }
      );
    }
    const trimmed = title.trim();
    if (!trimmed) {
      return NextResponse.json(
        { success: false, error: "title cannot be empty" },
        { status: 400 }
      );
    }
    payload.title = trimmed;
  }

  if (target_level !== undefined) {
    if (!isOptionalString(target_level)) {
      return NextResponse.json(
        { success: false, error: "target_level must be a string or null" },
        { status: 400 }
      );
    }
    payload.target_level = normalizeOptional(target_level) ?? null;
  }

  if (target_function !== undefined) {
    if (!isOptionalString(target_function)) {
      return NextResponse.json(
        { success: false, error: "target_function must be a string or null" },
        { status: 400 }
      );
    }
    payload.target_function = normalizeOptional(target_function) ?? null;
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json(
      { success: false, error: "No fields to update" },
      { status: 400 }
    );
  }

  try {
    const data = await updateCareerGoal(id, payload);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to update career goal");
  }
}

export async function DELETE(_req: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    await deleteCareerGoal(id);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    return errorResponse(error, "Failed to delete career goal");
  }
}
