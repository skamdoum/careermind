import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CompareError } from "./input";

// Privileged storage access stays behind both record and storage-namespace checks.
export async function downloadOwnedCompareResume(client: SupabaseClient, userId: string, profileId: string, resumeId: string) {
  const { data: resume, error } = await client.from("resumes")
    .select("id,user_id,career_profile_id,file_path,file_name,mime_type")
    .eq("id", resumeId).eq("user_id", userId).eq("career_profile_id", profileId).maybeSingle();
  if (error) throw new CompareError(503, "Could not load resume");
  if (!resume) throw new CompareError(404, "Resume not found in the active career profile");

  // Metadata registration accepts a client path. An owned row alone cannot
  // authorize the service role to download an object in another user's folder.
  const path = resume.file_path;
  const segments = typeof path === "string" ? path.split("/") : [];
  if (segments.length < 2 || segments[0] !== userId || segments.some(part => !part || part === "." || part === ".." || /[%?#\\\x00-\x1f\x7f]/.test(part))) {
    throw new CompareError(403, "Resume storage reference is not authorized");
  }
  const { data, error: downloadError } = await supabaseAdmin.storage.from("resumes").download(path);
  if (downloadError || !data) throw new Error("Could not download resume");
  return new File([await data.arrayBuffer()], resume.file_name || "resume.pdf", {
    type: resume.mime_type || "application/octet-stream",
  });
}
