import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { providerEvent } from "./telemetry";

export async function insertProviderEvent(event: ReturnType<typeof providerEvent>) {
  const signal = AbortSignal.timeout(1000);
  const { error } = await supabaseAdmin.from("telemetry_events")
    .insert(event).abortSignal(signal);
  if (!error) return;
  if (error.code !== "23505") throw new Error("Telemetry write failed");

  // A unique violation may be a retried write, a reused receipt on another
  // call, or a different receipt for this call. Never overwrite the first row.
  const { data: existing, error: lookupError } = await supabaseAdmin.from("telemetry_events")
    .select("operation_id,call_index,user_id,provider_response_id")
    .eq("event_key", event.event_key).abortSignal(signal).maybeSingle();
  if (lookupError) throw new Error("Telemetry receipt identity lookup failed");
  if (existing && existing.operation_id === event.operation_id
    && existing.call_index === event.call_index && existing.user_id === event.user_id
    && existing.provider_response_id === event.provider_response_id) return;
  console.warn("[telemetry] provider receipt identity conflict");
}

export async function linkAnalysis(operationId: string, userId: string, analysisId: string) {
  const { error } = await supabaseAdmin.from("telemetry_events")
    .update({ analysis_id: analysisId }).eq("operation_id", operationId).eq("user_id", userId)
    .abortSignal(AbortSignal.timeout(1000));
  if (error) throw new Error("Telemetry correlation failed");
}
