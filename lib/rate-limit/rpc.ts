// Thin RPC wrappers over the Postgres functions in
// supabase/migrations/*_rate_limits.sql.
//
// Fail-safe policy:
//   * try_consume_rate_limit → on infra failure, fail-open unless the
//     CAREERMIND_RATE_LIMIT_FAIL_CLOSED env flag is set. Logged as a
//     critical warning either way.
//   * complete / fail / refund → best-effort. These run after the
//     user-visible work is done; infrastructure failures here only
//     affect quota accounting and are logged.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import {
  failClosed,
  type RateLimitBucket,
  type ReservationOutcome,
  type ReservationResult,
} from "./types";

type RpcRow = {
  outcome: ReservationOutcome;
  event_id: string | null;
  result_ref: string | null;
  used: number;
  quota_limit: number;
  retry_after_seconds: number;
};

export type ConsumeArgs = {
  userId: string;
  bucket: RateLimitBucket;
  limit: number;
  idempotencyKey?: string;
};

export async function tryConsume(args: ConsumeArgs): Promise<ReservationResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc("try_consume_rate_limit", {
      p_user_id: args.userId,
      p_bucket: args.bucket,
      p_limit: args.limit,
      p_idempotency_key: args.idempotencyKey ?? null,
    });
    if (error) {
      throw new Error(error.message);
    }
    const row = Array.isArray(data) ? (data[0] as RpcRow | undefined) : (data as RpcRow | undefined);
    if (!row) {
      throw new Error("try_consume_rate_limit returned no row");
    }
    return {
      outcome: row.outcome,
      event_id: row.event_id,
      result_ref: row.result_ref,
      used: row.used,
      quota_limit: row.quota_limit,
      retry_after_seconds: row.retry_after_seconds,
    };
  } catch (err) {
    log.error("rate_limit.rpc_consume_failed", {
      bucket: args.bucket,
      user_id_prefix: args.userId.slice(0, 8),
      message: err instanceof Error ? err.message : String(err),
      fail_closed: failClosed(),
    });
    if (failClosed()) {
      return {
        outcome: "rate_limited",
        event_id: null,
        result_ref: null,
        used: args.limit,
        quota_limit: args.limit,
        retry_after_seconds: 60,
      };
    }
    // Fail-open: synthetic reservation so the request proceeds. Marks
    // event_id = null so downstream complete/refund are no-ops.
    return {
      outcome: "reserved",
      event_id: null,
      result_ref: null,
      used: 0,
      quota_limit: args.limit,
      retry_after_seconds: 0,
    };
  }
}

export async function markCompleted(args: {
  userId: string;
  eventId: string | null;
  resultRef?: string | null;
}): Promise<void> {
  if (!args.eventId) return;
  try {
    const { error } = await supabaseAdmin.rpc("complete_rate_limit", {
      p_event_id: args.eventId,
      p_user_id: args.userId,
      p_result_ref: args.resultRef ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    log.warn("rate_limit.rpc_complete_failed", {
      event_id: args.eventId,
      user_id_prefix: args.userId.slice(0, 8),
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function markFailed(args: {
  userId: string;
  eventId: string | null;
}): Promise<void> {
  if (!args.eventId) return;
  try {
    const { error } = await supabaseAdmin.rpc("fail_rate_limit", {
      p_event_id: args.eventId,
      p_user_id: args.userId,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    log.warn("rate_limit.rpc_fail_failed", {
      event_id: args.eventId,
      user_id_prefix: args.userId.slice(0, 8),
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function refund(args: {
  userId: string;
  eventId: string | null;
}): Promise<void> {
  if (!args.eventId) return;
  try {
    const { error } = await supabaseAdmin.rpc("refund_rate_limit", {
      p_event_id: args.eventId,
      p_user_id: args.userId,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    log.warn("rate_limit.rpc_refund_failed", {
      event_id: args.eventId,
      user_id_prefix: args.userId.slice(0, 8),
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
