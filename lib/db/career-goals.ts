import { createClient } from "@/lib/supabase/server";

export type CareerGoal = {
  id: string;
  user_id: string;
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

export async function createCareerGoal(
  input: CreateCareerGoalInput
): Promise<CareerGoal> {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("career_goals")
    .insert({
      user_id: user.id,
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
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("career_goals")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch career goals: ${error.message}`);
  }

  return (data ?? []) as CareerGoal[];
}

export async function getCareerGoalById(
  id: string
): Promise<CareerGoal | null> {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("career_goals")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch career goal: ${error.message}`);
  }

  return (data as CareerGoal | null) ?? null;
}
