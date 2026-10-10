// Classifier for OpenAI SDK errors. "Transient" = refund the rate-
// limit reservation (provider-side problem, not the user's fault, not
// a bug in our code). "Permanent" = do not refund (our bug or user
// input problem; the quota is consumed).
//
// This decides refund policy only. The caller still returns an error
// to the client either way.

import OpenAI from "openai";

export type OpenAIErrorClass =
  | "transient_5xx"
  | "transient_timeout"
  | "transient_connection"
  | "transient_openai_rate_limit"
  | "permanent_4xx"
  | "permanent_other";

export function classifyOpenAIError(err: unknown): OpenAIErrorClass {
  // SDK error hierarchy (openai v6):
  //   APIError (base)
  //     APIConnectionError
  //       APIConnectionTimeoutError
  //     APIUserAbortError
  //     RateLimitError (status 429) — treat as transient (OpenAI capacity, not our bug)
  //     InternalServerError (5xx)
  //     ...
  if (err instanceof OpenAI.APIConnectionTimeoutError) return "transient_timeout";
  if (err instanceof OpenAI.APIConnectionError) return "transient_connection";
  if (err instanceof OpenAI.RateLimitError) return "transient_openai_rate_limit";
  if (err instanceof OpenAI.APIError) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number" && status >= 500) return "transient_5xx";
    if (typeof status === "number" && status >= 400 && status < 500) return "permanent_4xx";
    return "permanent_other";
  }
  // Non-SDK error (e.g., JSON.parse of structured output failed) is a
  // our-side issue. Do not refund.
  return "permanent_other";
}

export function isTransient(cls: OpenAIErrorClass): boolean {
  return cls.startsWith("transient_");
}
