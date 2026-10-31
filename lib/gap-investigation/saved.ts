import type { SupabaseClient } from "@supabase/supabase-js";

export type SavedInvestigation = {
  id: string;
  seed_gap_id: string | null;
  status: "active" | "concluded" | "abandoned";
  created_at: string;
  // Display metadata, populated separately so creation/reuse reads are unchanged.
  saved_answer_count?: number;
};

// Discovery must not create a profile or silently switch to a default profile.
export async function existingActiveProfile(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data: pointer, error } = await client.from("profiles").select("active_career_profile_id").eq("id", userId).maybeSingle();
  if (error) throw new Error("Could not load active job search");
  if (!pointer?.active_career_profile_id) return null;
  const { data: profile, error: profileError } = await client.from("career_profiles").select("id")
    .eq("id", pointer.active_career_profile_id).eq("user_id", userId).maybeSingle();
  if (profileError) throw new Error("Could not load active job search");
  return profile?.id ?? null;
}

export async function readSavedInvestigations(client: SupabaseClient, userId: string, profileId: string, analysisId: string): Promise<SavedInvestigation[]> {
  // Verify the parent too, rather than trusting only duplicated scope columns.
  const { data: analysis, error } = await client.from("analyses").select("id").eq("id", analysisId)
    .eq("user_id", userId).eq("career_profile_id", profileId).maybeSingle();
  if (error || !analysis) throw new Error("Could not load investigations for this analysis");
  const rows: SavedInvestigation[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error: readError } = await client.from("gap_investigations")
      .select("id,seed_gap_id,status,created_at").eq("user_id", userId).eq("career_profile_id", profileId)
      .eq("seed_analysis_id", analysisId).order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 99);
    if (readError) throw new Error("Could not load saved investigations. Reload before starting an investigation.");
    rows.push(...(data ?? []));
    if ((data ?? []).length < 100) return rows;
  }
}

// IDs must come from readSavedInvestigations, which verifies the parent scope.
// Read only user-turn IDs/relationships, never transcript content. Batch IN lists
// and paginate results: one request per investigation would turn history into N+1.
export async function readSavedAnswerCounts(client: SupabaseClient, userId: string, investigationIds: string[]) {
  const counts = new Map(investigationIds.map(id => [id, 0]));
  for (let start = 0; start < investigationIds.length; start += 100) {
    const ids = investigationIds.slice(start, start + 100);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("gap_investigation_turns").select("id,investigation_id")
        .eq("user_id", userId).eq("role", "user").in("investigation_id", ids)
        .order("id", { ascending: true }).range(offset, offset + 499);
      if (error) throw new Error("Saved answer counts could not be loaded");
      for (const row of data ?? []) {
        if (counts.has(row.investigation_id)) counts.set(row.investigation_id, counts.get(row.investigation_id)! + 1);
      }
      if ((data ?? []).length < 500) break;
    }
  }
  return counts;
}

export function investigationsForGap(rows: SavedInvestigation[], gapId: string) {
  const history = rows.filter(row => row.seed_gap_id === gapId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  return { primary: history.find(row => row.status === "active") ?? history.find(row => row.status === "concluded") ?? null, history };
}

export async function hasInitialAssistantTurn(client: SupabaseClient, userId: string, investigationId: string) {
  const { data, error } = await client.from("gap_investigation_turns").select("id")
    .eq("investigation_id", investigationId).eq("user_id", userId).eq("role", "assistant").eq("turn_index", 0).limit(1);
  if (error) throw new Error("Could not verify investigation initialization");
  return Boolean(data?.length);
}

export const INITIALIZATION_ERROR = "This investigation has not finished initializing. Reload to check again. Your saved data has been kept; no new AI session will be started. If this persists, contact support.";
