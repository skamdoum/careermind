import type { Route } from "./provider";

// GPT-4.1 standard text pricing verified 2026-11-08. Nano-USD per token:
// ordinary input 2,000; cached input 500; output 8,000.
export const PRICING_VERSION = "gpt41-standard-2026-11-08-v1";
export type TelemetryScope = { analysis_id?: string; investigation_id?: string };
export type ProviderMeasurement = {
  operationId: string; callIndex: number; userId: string; route: Route;
  scope?: TelemetryScope; latencyMs: number; model: string;
  outcome: "success" | "incomplete" | "rejected" | "unknown";
  responseId?: string; usage?: unknown;
};

function tokens(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function providerEvent(measurement: ProviderMeasurement, vercelEnv = process.env.VERCEL_ENV) {
  const usage = measurement.usage as {
    input_tokens?: unknown; output_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
  } | undefined;
  const input = tokens(usage?.input_tokens);
  const output = tokens(usage?.output_tokens);
  const rawCached = tokens(usage?.input_tokens_details?.cached_tokens);
  const cached = input !== null && rawCached !== null && rawCached <= input ? rawCached : null;
  const priced = ["gpt-4.1", "gpt-4.1-2025-04-14"].includes(measurement.model);
  const cost = priced && input !== null && cached !== null && output !== null
    ? (input - cached) * 2000 + cached * 500 + output * 8000 : null;
  return {
    event_key: `ai:${measurement.operationId}:${measurement.callIndex}`,
    event_type: "ai_call" as const,
    user_id: measurement.userId,
    operation_id: measurement.operationId,
    call_index: measurement.callIndex,
    analysis_id: measurement.scope?.analysis_id ?? null,
    investigation_id: measurement.scope?.investigation_id ?? null,
    environment: ["production", "preview", "development"].includes(vercelEnv ?? "") ? vercelEnv! : "unknown",
    route: measurement.route,
    model: measurement.model,
    provider_response_id: measurement.responseId ?? null,
    input_tokens: input, cached_input_tokens: cached, output_tokens: output,
    pricing_version: priced ? PRICING_VERSION : null,
    estimated_cost_nanousd: cost !== null && Number.isSafeInteger(cost) ? cost : null,
    latency_ms: Math.max(0, Math.round(measurement.latencyMs)),
    outcome: measurement.outcome,
    error_category: measurement.outcome === "success" ? null
      : measurement.outcome === "rejected" ? "provider_rejected"
      : measurement.outcome === "incomplete" ? "provider_incomplete" : "provider_unknown",
  };
}

// No unawaited writes: Vercel may freeze a function after its response.
// Import/transport/schema errors are all contained; accounting remains independent.
export async function recordProviderMeasurement(measurement: ProviderMeasurement) {
  try {
    const { insertProviderEvent } = await import("./telemetry-store.server");
    await insertProviderEvent(providerEvent(measurement));
  } catch {
    console.warn("[telemetry] provider measurement unavailable");
  }
}

export async function linkAnalysisMeasurement(operationId: string, userId: string, analysisId: string) {
  try {
    const { linkAnalysis } = await import("./telemetry-store.server");
    await linkAnalysis(operationId, userId, analysisId);
  } catch {
    console.warn("[telemetry] analysis correlation unavailable");
  }
}
