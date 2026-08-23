import { requireUserAndActiveProfile } from "@/lib/db/career-profiles";

export type CareerGoal = {
  id: string;
  user_id: string;
  career_profile_id: string | null;
  title: string;
  target_level: string | null;
  target_function: string | null;
  status: string;
  primary_resume_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateCareerGoalInput = {
  title: string;
  target_level?: string | null;
  target_function?: string | null;
  primary_resume_id?: string | null;
};

export type UpdateCareerGoalInput = {
  title?: string;
  target_level?: string | null;
  target_function?: string | null;
};

export async function createCareerGoal(
  input: CreateCareerGoalInput
): Promise<CareerGoal> {
  const { supabase, user, activeProfileId } =
    await requireUserAndActiveProfile();

  const { data, error } = await supabase
    .from("career_goals")
    .insert({
      user_id: user.id,
      career_profile_id: activeProfileId,
      title: input.title,
      target_level: input.target_level ?? null,
      target_function: input.target_function ?? null,
      primary_resume_id: input.primary_resume_id ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create career goal: ${error.message}`);
  }

  return data as CareerGoal;
}

export async function getCareerGoalsByUser(): Promise<CareerGoal[]> {
  const { supabase, user, activeProfileId } =
    await requireUserAndActiveProfile();

  const { data, error } = await supabase
    .from("career_goals")
    .select("*")
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfileId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch career goals: ${error.message}`);
  }

  return (data ?? []) as CareerGoal[];
}

export async function getCareerGoalById(
  id: string
): Promise<CareerGoal | null> {
  const { supabase, user, activeProfileId } =
    await requireUserAndActiveProfile();

  const { data, error } = await supabase
    .from("career_goals")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch career goal: ${error.message}`);
  }

  return (data as CareerGoal | null) ?? null;
}

export async function updateCareerGoal(
  id: string,
  input: UpdateCareerGoalInput
): Promise<CareerGoal> {
  const { supabase, user, activeProfileId } =
    await requireUserAndActiveProfile();

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.title !== undefined) payload.title = input.title;
  if (input.target_level !== undefined) payload.target_level = input.target_level;
  if (input.target_function !== undefined) payload.target_function = input.target_function;

  const { data, error } = await supabase
    .from("career_goals")
    .update(payload)
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfileId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update career goal: ${error.message}`);
  }

  if (!data) {
    throw new Error("Career goal not found");
  }

  return data as CareerGoal;
}

export async function deleteCareerGoal(id: string): Promise<void> {
  const { supabase, user, activeProfileId } =
    await requireUserAndActiveProfile();

  const { data: existing, error: lookupError } = await supabase
    .from("career_goals")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfileId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to verify career goal: ${lookupError.message}`);
  }

  if (!existing) {
    throw new Error("Career goal not found");
  }

  // Delete the goal's target roles first, before the FK SET NULL would
  // orphan them on the goal delete below.
  const { error: jobsError } = await supabase
    .from("job_descriptions")
    .delete()
    .eq("career_goal_id", id)
    .eq("user_id", user.id);

  if (jobsError) {
    throw new Error(`Failed to delete target roles: ${jobsError.message}`);
  }

  const { error: goalError } = await supabase
    .from("career_goals")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("career_profile_id", activeProfileId);

  if (goalError) {
    throw new Error(`Failed to delete career goal: ${goalError.message}`);
  }
}
