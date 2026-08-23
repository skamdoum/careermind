import { NextResponse } from "next/server";
import {
  getCareerProfileById,
  updateCareerProfile,
} from "@/lib/db/career-profiles";

type RouteProps = {
  params: Promise<{ id: string }>;
};

function errorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  let status = 500;
  if (message === "Unauthorized") status = 401;
  else if (message === "Career profile not found") status = 404;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(_req: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    const data = await getCareerProfileById(id);

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Career profile not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to fetch career profile");
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

  const { name, description } = body as Record<string, unknown>;

  const payload: { name?: string; description?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== "string") {
      return NextResponse.json(
        { success: false, error: "name must be a string" },
        { status: 400 }
      );
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return NextResponse.json(
        { success: false, error: "name cannot be empty" },
        { status: 400 }
      );
    }
    payload.name = trimmed;
  }

  if (description !== undefined) {
    if (description !== null && typeof description !== "string") {
      return NextResponse.json(
        { success: false, error: "description must be a string or null" },
        { status: 400 }
      );
    }
    if (description === null) {
      payload.description = null;
    } else {
      const trimmed = (description as string).trim();
      payload.description = trimmed || null;
    }
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json(
      { success: false, error: "No fields to update" },
      { status: 400 }
    );
  }

  try {
    const data = await updateCareerProfile(id, payload);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to update career profile");
  }
}
