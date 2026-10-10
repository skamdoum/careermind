// Orchestrator for OpenAI-backed route calls.
//
// This helper implements the legacy reservation lifecycle. Durable operations
// use lib/ai-operations/server.ts and transactional SQL instead. It can:
//   1. Reserve a rate-limit slot (optionally idempotent).
//   2. Run their OpenAI work inside the reservation.
//   3. Automatically mark completed / failed / refunded based on how
//      the work ends.
//
// Idempotency semantics (duplicate requests with the same idempotency key):
//   duplicate_in_progress → return { kind: 'duplicate_in_progress' } so
//       the route emits HTTP 409 and does NOT invoke OpenAI.
//   duplicate_completed   → return { kind: 'duplicate_completed', result_ref }
//       so the route can look up its prior artifact and return it.
//   duplicate_failed      → return { kind: 'duplicate_failed' } for the
//       route to emit HTTP 500 "retry with a new idempotency key".
//   duplicate_refunded    → return { kind: 'duplicate_refunded' } for
//       the route to emit HTTP 503 "transient failure, retry with a
//       new idempotency key".
//
// Fail-safe: the RPC layer fails open on infrastructure error. In that
// case event_id is null; complete / refund / fail are all no-ops. The
// request proceeds normally.

import type { RateLimitBucket, RateLimitExceededBody } from "./types";
import { RATE_LIMITS, friendlyBucketLabel } from "./types";
import { tryConsume, markCompleted, markFailed, refund } from "./rpc";
import { classifyOpenAIError, isTransient } from "./openai-errors";
import { log } from "@/lib/log";

export type WithReservationArgs = {
  userId: string;
  bucket: RateLimitBucket;
  idempotencyKey?: string;
};

type Succeeded<T> = {
  kind: "succeeded";
  value: T;
  resultRefToStore?: string | null;
  rateLimit: { used: number; limit: number };
};
type RateLimited = {
  kind: "rate_limited";
  body: RateLimitExceededBody;
  retryAfter: number;
};
type DuplicateInProgress = { kind: "duplicate_in_progress" };
type DuplicateCompleted = { kind: "duplicate_completed"; resultRef: string | null };
type DuplicateFailed = { kind: "duplicate_failed" };
type DuplicateRefunded = { kind: "duplicate_refunded" };
type OpenAIFailed = {
  kind: "openai_failed";
  errorClass: ReturnType<typeof classifyOpenAIError>;
  cause: unknown;
};

export type WithReservationResult<T> =
  | Succeeded<T>
  | RateLimited
  | DuplicateInProgress
  | DuplicateCompleted
  | DuplicateFailed
  | DuplicateRefunded
  | OpenAIFailed;

// The work function receives nothing — the OpenAI call is composed by
// the caller. Return { value, resultRef? }. resultRef is persisted on
// the reservation row for later idempotent replay.
export type WorkResult<T> = { value: T; resultRef?: string | null };

export async function withReservation<T>(
  args: WithReservationArgs,
  work: () => Promise<WorkResult<T>>
): Promise<WithReservationResult<T>> {
  const limit = RATE_LIMITS[args.bucket];
  const reservation = await tryConsume({
    userId: args.userId,
    bucket: args.bucket,
    limit,
    idempotencyKey: args.idempotencyKey,
  });

  switch (reservation.outcome) {
    case "rate_limited": {
      const body: RateLimitExceededBody = {
        success: false,
        error: "rate_limit_exceeded",
        message: `You've reached the hourly limit for ${friendlyBucketLabel(
          args.bucket
        )}. Try again in about ${Math.max(
          1,
          Math.ceil(reservation.retry_after_seconds / 60)
        )} minute(s).`,
        bucket: args.bucket,
        limit: reservation.quota_limit,
        used: reservation.used,
        retry_after_seconds: reservation.retry_after_seconds,
      };
      log.info("rate_limit.exceeded", {
        bucket: args.bucket,
        user_id_prefix: args.userId.slice(0, 8),
        used: reservation.used,
        limit: reservation.quota_limit,
      });
      return { kind: "rate_limited", body, retryAfter: reservation.retry_after_seconds };
    }
    case "duplicate_in_progress":
      log.info("rate_limit.idempotent_in_progress", {
        bucket: args.bucket,
        user_id_prefix: args.userId.slice(0, 8),
      });
      return { kind: "duplicate_in_progress" };
    case "duplicate_completed":
      log.info("rate_limit.idempotent_replay_completed", {
        bucket: args.bucket,
        user_id_prefix: args.userId.slice(0, 8),
      });
      return { kind: "duplicate_completed", resultRef: reservation.result_ref };
    case "duplicate_failed":
      return { kind: "duplicate_failed" };
    case "duplicate_refunded":
      return { kind: "duplicate_refunded" };
    case "reserved": {
      try {
        const { value, resultRef } = await work();
        await markCompleted({
          userId: args.userId,
          eventId: reservation.event_id,
          resultRef: resultRef ?? null,
        });
        return {
          kind: "succeeded",
          value,
          resultRefToStore: resultRef ?? null,
          rateLimit: { used: reservation.used, limit: reservation.quota_limit },
        };
      } catch (err) {
        const errorClass = classifyOpenAIError(err);
        if (isTransient(errorClass)) {
          await refund({ userId: args.userId, eventId: reservation.event_id });
          log.warn("rate_limit.refunded_transient_openai", {
            bucket: args.bucket,
            user_id_prefix: args.userId.slice(0, 8),
            error_class: errorClass,
          });
        } else {
          await markFailed({ userId: args.userId, eventId: reservation.event_id });
          log.warn("rate_limit.consumed_permanent_failure", {
            bucket: args.bucket,
            user_id_prefix: args.userId.slice(0, 8),
            error_class: errorClass,
          });
        }
        return { kind: "openai_failed", errorClass, cause: err };
      }
    }
  }
}

// Convenience: standardized 429 response. Routes can import and return.
export function rateLimitedResponse(
  r: RateLimited
): { body: RateLimitExceededBody; headers: Record<string, string>; status: number } {
  return {
    status: 429,
    headers: {
      "Retry-After": String(Math.max(1, r.retryAfter)),
      "X-RateLimit-Limit": String(r.body.limit),
      "X-RateLimit-Remaining": "0",
    },
    body: r.body,
  };
}

// Convenience: build a usage header set to attach on successful routes.
export function rateLimitHeaders(args: { used: number; limit: number }): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(args.limit),
    "X-RateLimit-Remaining": String(Math.max(0, args.limit - args.used)),
  };
}
