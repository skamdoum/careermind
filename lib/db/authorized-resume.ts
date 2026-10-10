import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthorizedResume = {
  id: string;
  user_id: string;
  career_profile_id: string;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
};

// Legacy file-path requests still require a matching owned database row.
// Never pass client-supplied paths or metadata directly to storage.
export async function resolveAuthorizedResume(
  client: SupabaseClient,
  userId: string,
  profileId: string,
  reference: { id?: string | null; file_path?: string | null }
): Promise<AuthorizedResume | null> {
  if (!reference.id && !reference.file_path) return null;
  let query = client.from("resumes")
    .select("id,user_id,career_profile_id,file_path,file_name,mime_type")
    .eq("user_id", userId).eq("career_profile_id", profileId);
  query = reference.id ? query.eq("id", reference.id) : query.eq("file_path", reference.file_path);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("Failed to resolve resume access");
  // Defense in depth, including for a mistakenly configured query/client.
  if (!data || data.user_id !== userId || data.career_profile_id !== profileId) return null;
  return data as AuthorizedResume;
}
