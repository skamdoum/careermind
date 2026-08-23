import { createClient } from "@/lib/supabase/server";

export type CareerProfile = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateCareerProfileInput = {
  name: string;
  description?: string | null;
};

export type UpdateCareerProfileInput = {
  name?: string;
  description?: string | null;
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

/**
 * Returns the active career profile for the authenticated user.
 * Falls back to the user's default profile if the pointer is unset;
 * lazily creates a default profile if none exists.
 */
export async function getActiveCareerProfile(): Promise<CareerProfile> {
  const { supabase, user } = await requireUser();
  return resolveActiveCareerProfile(supabase, user.id);
}

/**
 * Returns just the active profile id — convenience for scoping queries.
 */
export async function getActiveCareerProfileId(): Promise<string> {
  const profile = await getActiveCareerProfile();
  return profile.id;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Same as getActiveCareerProfile but uses a caller-provided supabase client
 * and userId — avoids duplicate auth.getUser round trips in helpers.
 */
export async function resolveActiveCareerProfile(
  supabase: SupabaseServerClient,
  userId: string
): Promise<CareerProfile> {
  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("active_career_profile_id")
    .eq("id", userId)
    .maybeSingle();

  if (profErr) {
    throw new Error(`Failed to load profile: ${profErr.message}`);
  }

  if (prof?.active_career_profile_id) {
    const { data: cp } = await supabase
      .from("career_profiles")
      .select("*")
      .eq("id", prof.active_career_profile_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (cp) return cp as CareerProfile;
  }

  const { data: def } = await supabase
    .from("career_profiles")
    .select("*")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();

  if (def) {
    await supabase
      .from("profiles")
      .update({ active_career_profile_id: def.id })
      .eq("id", userId);
    return def as CareerProfile;
  }

  const { data: created, error: createErr } = await supabase
    .from("career_profiles")
    .insert({
      user_id: userId,
      name: "My career direction",
      is_default: true,
    })
    .select()
    .single();

  if (createErr || !created) {
    throw new Error(
      `Failed to create default career profile: ${createErr?.message ?? "unknown"}`
    );
  }

  await supabase
    .from("profiles")
    .update({ active_career_profile_id: created.id })
    .eq("id", userId);

  return created as CareerProfile;
}

/**
 * Bundles auth + active-profile resolution into one call. Use this in helpers
 * that need both user id and active career_profile_id for scoping.
 */
export async function requireUserAndActiveProfile(): Promise<{
  supabase: SupabaseServerClient;
  user: { id: string; email?: string | null };
  activeProfileId: string;
}> {
  const { supabase, user } = await requireUser();
  const profile = await resolveActiveCareerProfile(supabase, user.id);
  return {
    supabase,
    user: { id: user.id, email: user.email ?? null },
    activeProfileId: profile.id,
  };
}

export async function getCareerProfilesForUser(): Promise<CareerProfile[]> {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("career_profiles")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load career profiles: ${error.message}`);
  }

  return (data ?? []) as CareerProfile[];
}

export async function getCareerProfileById(
  id: string
): Promise<CareerProfile | null> {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("career_profiles")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch career profile: ${error.message}`);
  }

  return (data as CareerProfile | null) ?? null;
}

export async function createCareerProfile(
  input: CreateCareerProfileInput
): Promise<CareerProfile> {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("career_profiles")
    .insert({
      user_id: user.id,
      name: input.name,
      description: input.description ?? null,
      is_default: false,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create career profile: ${error.message}`);
  }

  return data as CareerProfile;
}

export async function updateCareerProfile(
  id: string,
  input: UpdateCareerProfileInput
): Promise<CareerProfile> {
  const { supabase, user } = await requireUser();

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;

  const { data, error } = await supabase
    .from("career_profiles")
    .update(payload)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update career profile: ${error.message}`);
  }

  if (!data) {
    throw new Error("Career profile not found");
  }

  return data as CareerProfile;
}

export async function switchActiveCareerProfile(
  id: string
): Promise<CareerProfile> {
  const { supabase, user } = await requireUser();

  const { data: cp, error: cpErr } = await supabase
    .from("career_profiles")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (cpErr) {
    throw new Error(`Failed to verify career profile: ${cpErr.message}`);
  }

  if (!cp) {
    throw new Error("Career profile not found");
  }

  const { error: updErr } = await supabase
    .from("profiles")
    .update({ active_career_profile_id: id })
    .eq("id", user.id);

  if (updErr) {
    throw new Error(`Failed to switch career profile: ${updErr.message}`);
  }

  return cp as CareerProfile;
}
