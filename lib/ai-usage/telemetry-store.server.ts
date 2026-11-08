import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { providerEvent } from "./telemetry";

export async function insertProviderEvent(event: ReturnType<typeof providerEvent>) {
  const { error } = await supabaseAdmin.from("telemetry_events")
    .upsert(event, { onConflict: "event_key", ignoreDuplicates: true })
    .abortSignal(AbortSignal.timeout(1000));
  // The response ID has an additional unique constraint. Neither conflict may
  // overwrite an existing measurement or cause an application/provider retry.
  if (error && error.code !== "23505") throw new Error("Telemetry write failed");
}

export async function linkAnalysis(operationId: string, userId: string, analysisId: string) {
  const { error } = await supabaseAdmin.from("telemetry_events")
    .update({ analysis_id: analysisId }).eq("operation_id", operationId).eq("user_id", userId)
    .abortSignal(AbortSignal.timeout(1000));
  if (error) throw new Error("Telemetry correlation failed");
}
