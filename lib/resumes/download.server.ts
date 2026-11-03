import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertOwnedResumePath, ResumeAccessError } from "./authorization";

// Callers obtain userId from verified auth and profileId from an owned profile.
// Always re-read the exact row: callers must never supply metadata to authorize
// a privileged download. This also protects previously registered forged paths.
export async function readOwnedResume(client: SupabaseClient, userId: string, profileId: string, resumeId: string) {
  if (!userId || !profileId || !resumeId) throw new ResumeAccessError(404, "Resume not found in the active career profile");
  const { data: resume, error } = await client.from("resumes")
    .select("id,user_id,career_profile_id,file_path,file_name,mime_type")
    .eq("id", resumeId).eq("user_id", userId).eq("career_profile_id", profileId).maybeSingle();
  if (error) throw new ResumeAccessError(503, "Could not load resume");
  if (!resume) throw new ResumeAccessError(404, "Resume not found in the active career profile");
  assertOwnedResumePath(resume.file_path, userId);
  return resume;
}

export async function downloadOwnedResume(client: SupabaseClient, userId: string, profileId: string, resumeId: string) {
  const resume=await readOwnedResume(client,userId,profileId,resumeId);
  const { data, error: downloadError } = await supabaseAdmin.storage.from("resumes").download(resume.file_path);
  if (downloadError || !data) throw new Error("Could not download resume");
  const file = new File([await data.arrayBuffer()], resume.file_name || "resume.pdf", {
    type: resume.mime_type || "application/octet-stream",
  });
  return { resume, file };
}
