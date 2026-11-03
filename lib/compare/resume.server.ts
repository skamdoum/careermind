import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadOwnedResume } from "@/lib/resumes/download.server";
import { ResumeAccessError } from "@/lib/resumes/authorization";
import { CompareError } from "./input";

// Preserve Compare's error contract while sharing the privileged access guard.
export async function downloadOwnedCompareResume(client: SupabaseClient, userId: string, profileId: string, resumeId: string) {
  try {
    return (await downloadOwnedResume(client, userId, profileId, resumeId)).file;
  } catch (error) {
    if (error instanceof ResumeAccessError) throw new CompareError(error.status, error.message);
    throw error;
  }
}
