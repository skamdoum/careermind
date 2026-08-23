import { NextResponse } from "next/server";
import {
  createCareerProfile,
  getCareerProfilesForUser,
} from "@/lib/db/career-profiles";

function errorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  const status = message === "Unauthorized" ? 401 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET() {
  try {
    const data = await getCareerProfilesForUser();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to load career profiles");
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

  const { name, description } = body as Record<string, unknown>;

  if (typeof name !== "string") {
    return NextResponse.json(
      { success: false, error: "name is required and must be a string" },
      { status: 400 }
    );
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    return NextResponse.json(
      { success: false, error: "name cannot be empty" },
      { status: 400 }
    );
  }

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    return NextResponse.json(
      { success: false, error: "description must be a string or null" },
      { status: 400 }
    );
  }

  const normalizedDescription =
    description === undefined || description === null
      ? null
      : (description as string).trim() || null;

  try {
    const data = await createCareerProfile({
      name: trimmedName,
      description: normalizedDescription,
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Failed to create career profile");
  }
}
