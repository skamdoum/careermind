import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { InvestigationContextSnapshot } from "@/lib/db/gap-investigations";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { classifyOpenAIError, isTransient } from "@/lib/rate-limit/openai-errors";

export type OperationKind = "analyze" | "gap_kickoff" | "gap_turn";
export type OperationContext = {
  career_profile_id: string;
  resume?: { id: string; file_path: string; file_name: string | null; mime_type: string | null; user_id?: string; career_profile_id?: string | null } | null;
  resumeText?: string | null;
  jobDescription?: string;
  targetRole?: string;
  targetLevel?: string;
  snapshot?: InvestigationContextSnapshot;
  seed_gap_id?: string;
  seed_analysis_id?: string;
  gap_code?: string | null;
};
type Quota = { quota_limit: number; used: number; retry_after_seconds: number };
type SavedResult = { analysisId?: string; planId?: string; result?: unknown; investigation_id?: string };
export type Claim = {
  outcome: "claimed";
  id: string;
  token: string;
  context: OperationContext;
  checkpoint: unknown | null;
  investigation_id: string | null;
  user_turn_id: string | null;
  quota?: Quota;
};
export type OperationReply = Claim | {
  outcome: "completed" | "pending" | "conflict" | "in_progress" | "rate_limited" | "not_found" | "inactive" | "unavailable" | "legacy_key" | "free_limited";
  result?: SavedResult;
  context?: OperationContext;
  checkpoint?: unknown;
  quota?: Quota;
};

export function inputHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export class OperationError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
export function operationErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof OperationError)) return null;
  if (error.code === "free_limit_reached") return NextResponse.json({ success: false, error: "Free limit reached", data: { code: "LIMIT_REACHED" } }, { status: 403 });
  return NextResponse.json({ success: false, error: error.code, message: error.message }, { status: error.status });
}
export function operationUsageHeaders(claim: Claim): Record<string, string> {
  return claim.quota ? { "X-RateLimit-Limit": String(claim.quota.quota_limit), "X-RateLimit-Remaining": String(Math.max(0, claim.quota.quota_limit - claim.quota.used)) } : {};
}
export function requestKey(req: Request): string | null {
  const key = req.headers.get("Idempotency-Key");
  if (key !== null && (!key.trim() || key.length > 200)) throw new OperationError("Invalid idempotency key", 400, "invalid_idempotency_key");
  return key;
}
// Privileged RPCs are service-role-only. userId must come from auth.getUser(),
// never the request body; it is appended last so supplied args cannot override it.
// Operation infrastructure deliberately fails closed. There is no safe fallback
// for atomic persistence or conversation serialization when this RPC is unavailable.
export async function operationRpc<T>(userId: string, name: "lookup_career_operation" | "claim_career_operation" | "checkpoint_career_operation" | "release_career_operation" | "finalize_career_analysis" | "finalize_career_gap", args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc(name, { ...args, p_user_id: userId });
  if (error) {
    console.error("[career-ai-operation] RPC failed", { rpc: name, code: error.code });
    if (error.message === "Free limit reached") throw new OperationError("Free limit reached", 403, "free_limit_reached");
    if (error.code === "40001") throw new OperationError("This attempt expired. Retry the same request.", 409, "operation_lease_lost");
    if (error.code === "42501") throw new OperationError("This operation is not authorized.", 403, "operation_not_authorized");
    throw new OperationError("The operation could not be saved. Retry the same request.", error.code?.startsWith("23") ? 500 : 503, "operation_unavailable");
  }
  return data as T;
}
export async function lookupOperation(userId: string, kind: OperationKind, key: string | null, hash: string) {
  if (!key) return null;
  return operationRpc<OperationReply | null>(userId, "lookup_career_operation", { p_kind: kind, p_key: key, p_hash: hash });
}
export async function claimOperation(userId: string, args: {
  kind: OperationKind; key: string | null; hash: string; context: Record<string, unknown>;
  investigationId?: string; content?: string; questionId?: string | null;
}) {
  return operationRpc<OperationReply>(userId, "claim_career_operation", {
    p_kind: args.kind, p_key: args.key, p_hash: args.hash, p_context: args.context,
    p_investigation_id: args.investigationId ?? null, p_content: args.content ?? null, p_question_id: args.questionId ?? null,
  });
}
export function operationResponse(reply: OperationReply, kind: OperationKind): NextResponse | null {
  if (reply.outcome === "claimed" || reply.outcome === "pending") return null;
  if (reply.outcome === "free_limited") return NextResponse.json({ success: false, error: "Free limit reached", data: { code: "LIMIT_REACHED" } }, { status: 403 });
  if (reply.outcome === "completed") return NextResponse.json({ success: true, data: reply.result, idempotent_replay: true });
  if (reply.outcome === "rate_limited") {
    const quota = reply.quota!;
    const bucket = kind === "analyze" ? "analyze" : "gap_turn";
    return NextResponse.json({ success: false, error: "rate_limit_exceeded", message: `You've reached the hourly limit. Try again in about ${Math.max(1, Math.ceil(quota.retry_after_seconds / 60))} minute(s).`, bucket, limit: quota.quota_limit, used: quota.used, retry_after_seconds: quota.retry_after_seconds }, { status: 429, headers: { "Retry-After": String(quota.retry_after_seconds) } });
  }
  const errors = {
    conflict: [409, "idempotency_conflict", "This request conflicts with an existing operation. Retry the original request or refresh the conversation."],
    in_progress: [409, "duplicate_in_progress", "Your request is still processing. Retry shortly with the same request."],
    not_found: [404, "Investigation not found", "Investigation not found"],
    legacy_key: [409, "legacy_idempotency_key", "This request predates the retry safety update. Start a new request with a new key after checking your saved results."],
    unavailable: [409, "idempotent_result_unavailable", "The saved result is no longer available. No new analysis was started."],
    inactive: [400, "Investigation is no longer active", "Investigation is no longer active"],
  } as const;
  const [status, error, message] = errors[reply.outcome as keyof typeof errors];
  return NextResponse.json({ success: false, error, message }, { status });
}

// Tests use this exact production path, replacing only network boundaries.
// A checkpoint retry never calls generate and keeps its original quota event.
export async function finishOperation<T>(
  claim: Claim,
  deps: {
    generate: () => Promise<unknown>;
    checkpoint: (output: unknown) => Promise<void>;
    finalize: (output: unknown) => Promise<T>;
    release: (transient: boolean) => Promise<void>;
  }
): Promise<T> {
  let generating = claim.checkpoint === null;
  try {
    let output = claim.checkpoint;
    if (output === null) {
      output = await deps.generate();
      generating = false;
      await deps.checkpoint(output);
    }
    return await deps.finalize(output);
  } catch (error) {
    // Refund only a classified provider failure, never failed DB persistence.
    try { await deps.release(generating && isTransient(classifyOpenAIError(error))); }
    catch { console.error("[career-ai-operation] release failed; lease recovery required", { operation_id: claim.id }); }
    throw error;
  }
}
export function operationLifecycle(userId: string, claim: Claim) {
  return {
    checkpoint: (output: unknown) => operationRpc<void>(userId, "checkpoint_career_operation", { p_id: claim.id, p_token: claim.token, p_output: output }),
    release: (transient: boolean) => operationRpc<void>(userId, "release_career_operation", { p_id: claim.id, p_token: claim.token, p_transient: transient }),
  };
}
