import { createClient } from "@/lib/supabase/server";

export type TargetJob = {
  id: string;
  user_id: string;
  career_goal_id: string | null;
  company_name: string | null;
  role_title: string | null;
  source_url: string | null;
  jd_text: string;
  status: string;
  created_at: string;
};

export type CreateTargetJobInput = {
  jd_text: string;
  company_name?: string | null;
  role_title?: string | null;
  source_url?: string | null;
};

export type UpdateTargetJobInput = {
  jd_text?: string;
  company_name?: string | null;
  role_title?: string | null;
  source_url?: string | null;
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error(error?.message || "Unauthorized");
  }

  return { supabase, user };
}

async function assertGoalOwnedByUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  goalId: string,
  userId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("career_goals")
    .select("id")
    .eq("id", goalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to verify career goal: ${error.message}`);
  }

  if (!data) {
    throw new Error("Career goal not found");
  }
}

export async function createTargetJob(
  careerGoalId: string,
  input: CreateTargetJobInput
): Promise<TargetJob> {
  const { supabase, user } = await requireUser();

  await assertGoalOwnedByUser(supabase, careerGoalId, user.id);

  const { data, error } = await supabase
    .from("job_descriptions")
    .insert({
      user_id: user.id,
      career_goal_id: careerGoalId,
      jd_text: input.jd_text,
      company_name: input.company_name ?? null,
      role_title: input.role_title ?? null,
      source_url: input.source_url ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create target job: ${error.message}`);
  }

  return data as TargetJob;
}

export async function getTargetJobsByGoal(
  careerGoalId: string
): Promise<TargetJob[]> {
  const { supabase, user } = await requireUser();

  await assertGoalOwnedByUser(supabase, careerGoalId, user.id);

  const { data, error } = await supabase
    .from("job_descriptions")
    .select("*")
    .eq("career_goal_id", careerGoalId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch target jobs: ${error.message}`);
  }

  return (data ?? []) as TargetJob[];
}

export async function getTargetJobById(
  id: string
): Promise<TargetJob | null> {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("job_descriptions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch target job: ${error.message}`);
  }

  return (data as TargetJob | null) ?? null;
}

export async function updateTargetJob(
  id: string,
  input: UpdateTargetJobInput
): Promise<TargetJob> {
  const { supabase, user } = await requireUser();

  const payload: Record<string, unknown> = {};
  if (input.jd_text !== undefined) payload.jd_text = input.jd_text;
  if (input.company_name !== undefined) payload.company_name = input.company_name;
  if (input.role_title !== undefined) payload.role_title = input.role_title;
  if (input.source_url !== undefined) payload.source_url = input.source_url;

  const { data, error } = await supabase
    .from("job_descriptions")
    .update(payload)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update target job: ${error.message}`);
  }

  if (!data) {
    throw new Error("Target job not found");
  }

  return data as TargetJob;
}

export async function deleteTargetJob(id: string): Promise<void> {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("job_descriptions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to delete target job: ${error.message}`);
  }

  if (!data) {
    throw new Error("Target job not found");
  }
}
