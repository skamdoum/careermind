import { NextResponse } from "next/server";
import {
  deleteTargetJob,
  getTargetJobById,
  updateTargetJob,
} from "@/lib/db/target-jobs";

type RouteProps = {
  params: Promise<{ id: string; jobId: string }>;
};

function errorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message ? error.message : fallback;

  let status = 500;
  if (message === "Unauthorized") status = 401;
  else if (message === "Target job not found") status = 404;

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

async function assertJobUnderGoal(
  jobId: string,
  careerGoalId: string
): Promise<boolean> {
  const existing = await getTargetJobById(jobId);
  return !!existing && existing.career_goal_id === careerGoalId;
}

export async function GET(_req: Request, { params }: RouteProps) {
  try {
    const { id: careerGoalId, jobId } = await params;

    const data = await getTargetJobById(jobId);

    if (!data || data.career_goal_id !== careerGoalId) {
      return NextResponse.json(
        { success: false, error: "Target job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to fetch target job");
  }
}

export async function PATCH(req: Request, { params }: RouteProps) {
  const { id: careerGoalId, jobId } = await params;

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

  const payload: {
    jd_text?: string;
    company_name?: string | null;
    role_title?: string | null;
    source_url?: string | null;
  } = {};

  if (jd_text !== undefined) {
    if (typeof jd_text !== "string") {
      return NextResponse.json(
        { success: false, error: "jd_text must be a string" },
        { status: 400 }
      );
    }
    const trimmed = jd_text.trim();
    if (!trimmed) {
      return NextResponse.json(
        { success: false, error: "jd_text cannot be empty" },
        { status: 400 }
      );
    }
    payload.jd_text = trimmed;
  }

  if (company_name !== undefined) {
    if (!isOptionalString(company_name)) {
      return NextResponse.json(
        { success: false, error: "company_name must be a string or null" },
        { status: 400 }
      );
    }
    payload.company_name = normalizeOptional(company_name) ?? null;
  }

  if (role_title !== undefined) {
    if (!isOptionalString(role_title)) {
      return NextResponse.json(
        { success: false, error: "role_title must be a string or null" },
        { status: 400 }
      );
    }
    payload.role_title = normalizeOptional(role_title) ?? null;
  }

  if (source_url !== undefined) {
    if (!isOptionalString(source_url)) {
      return NextResponse.json(
        { success: false, error: "source_url must be a string or null" },
        { status: 400 }
      );
    }
    payload.source_url = normalizeOptional(source_url) ?? null;
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json(
      { success: false, error: "No fields to update" },
      { status: 400 }
    );
  }

  try {
    const belongs = await assertJobUnderGoal(jobId, careerGoalId);
    if (!belongs) {
      return NextResponse.json(
        { success: false, error: "Target job not found" },
        { status: 404 }
      );
    }

    const data = await updateTargetJob(jobId, payload);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return errorResponse(error, "Failed to update target job");
  }
}

export async function DELETE(_req: Request, { params }: RouteProps) {
  try {
    const { id: careerGoalId, jobId } = await params;

    const belongs = await assertJobUnderGoal(jobId, careerGoalId);
    if (!belongs) {
      return NextResponse.json(
        { success: false, error: "Target job not found" },
        { status: 404 }
      );
    }

    await deleteTargetJob(jobId);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    return errorResponse(error, "Failed to delete target job");
  }
}
