// Legacy route limits. Durable service-only RPCs enforce analyze=5 and
// gap_turn=10 in SQL so a caller cannot supply a larger limit. Keep these
// display/legacy values aligned when deliberately changing quota policy.

export type RateLimitBucket = "analyze" | "gap_turn" | "narrative_uncached";

export const RATE_LIMITS: Record<RateLimitBucket, number> = {
  analyze: 5,
  gap_turn: 10,
  narrative_uncached: 5,
};

// Returned by the SQL function. Keep in sync with
// supabase/migrations/*_rate_limits.sql.
export type ReservationOutcome =
  | "reserved"
  | "duplicate_in_progress"
  | "duplicate_completed"
  | "duplicate_failed"
  | "duplicate_refunded"
  | "rate_limited";

export type ReservationResult = {
  outcome: ReservationOutcome;
  event_id: string | null;
  result_ref: string | null;
  used: number;
  quota_limit: number;
  retry_after_seconds: number;
};

// Fail-safe behavior. If the DB infrastructure (Supabase RPC) itself
// fails — not an OpenAI issue, not an abuse signal — we must not take
// the whole product down. Default is fail-open with aggressive logging.
// Flip CAREERMIND_RATE_LIMIT_FAIL_CLOSED=true as an escape hatch.
export function failClosed(): boolean {
  return (process.env.CAREERMIND_RATE_LIMIT_FAIL_CLOSED ?? "").toLowerCase() === "true";
}

// Shape of a client-visible 429 payload. Keep stable across routes so
// the UI has one error contract.
export type RateLimitExceededBody = {
  success: false;
  error: "rate_limit_exceeded";
  message: string;
  bucket: RateLimitBucket;
  limit: number;
  used: number;
  retry_after_seconds: number;
};

export function friendlyBucketLabel(bucket: RateLimitBucket): string {
  switch (bucket) {
    case "analyze":
      return "resume analyses";
    case "gap_turn":
      return "gap-investigation questions";
    case "narrative_uncached":
      return "narrative generations";
  }
}
