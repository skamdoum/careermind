import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
// Only this server module has access to privileged accounting RPCs.
export async function usageRPC(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await supabaseAdmin.rpc(name, args);
    if (error)
        throw new Error("AI usage store unavailable");
    return data;
}
