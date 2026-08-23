import { NextResponse } from "next/server";
import {
  createTargetJob,
  getTargetJobsByGoal,
} from "@/lib/db/target-jobs";

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

export async function GET(_req: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    const data = await getTargetJobsByGoal(id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to fetch target jobs");
  }
}

export async function POST(req: Request, { params }: RouteProps) {
  const { id: careerGoalId } = await params;

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

  const { jd_text, company_name, role_title, source_url } =
    body as Record<string, unknown>;

  if (typeof jd_text !== "string") {
    return NextResponse.json(
      { success: false, error: "jd_text is required and must be a string" },
      { status: 400 }
    );
  }

  const trimmedJd = jd_text.trim();
  if (!trimmedJd) {
    return NextResponse.json(
      { success: false, error: "jd_text cannot be empty" },
      { status: 400 }
    );
  }

  if (!isOptionalString(company_name)) {
    return NextResponse.json(
      { success: false, error: "company_name must be a string or null" },
      { status: 400 }
    );
  }

  if (!isOptionalString(role_title)) {
    return NextResponse.json(
      { success: false, error: "role_title must be a string or null" },
      { status: 400 }
    );
  }

  if (!isOptionalString(source_url)) {
    return NextResponse.json(
      { success: false, error: "source_url must be a string or null" },
      { status: 400 }
    );
  }

  const normalize = (v: string | null | undefined): string | null => {
    if (v === undefined || v === null) return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };

  try {
    const data = await createTargetJob(careerGoalId, {
      jd_text: trimmedJd,
      company_name: normalize(company_name),
      role_title: normalize(role_title),
      source_url: normalize(source_url),
    });

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Failed to create target job");
  }
}
