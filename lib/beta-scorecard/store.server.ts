import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Delivery, ScorecardStore } from "./delivery";

const table = () => supabaseAdmin.from("beta_scorecard_deliveries");
const deadline = () => AbortSignal.timeout(5000);
export const scorecardStore: ScorecardStore = {
  async report(week, external, internal) {
    const { data, error } = await supabaseAdmin.rpc("beta_scorecard_report", {
      p_week_start: week, p_external_ids: external, p_internal_ids: internal,
    }).abortSignal(deadline());
    if (error) throw new Error("Scorecard query failed");
    return data;
  },
  async find(week) {
    const { data, error } = await table().select("week_start,created_at,lease_until,attempt_token,state,payload")
      .eq("week_start", week).abortSignal(deadline()).maybeSingle();
    if (error) throw new Error("Delivery lookup failed");
    return data as Delivery | null;
  },
  async claim(row) {
    const { data, error } = await table().upsert({ ...row, state: "sending" },
      { onConflict: "week_start", ignoreDuplicates: true })
      .select("week_start").abortSignal(deadline()).maybeSingle();
    if (error) throw new Error("Delivery claim failed");
    return Boolean(data);
  },
  async reclaim(week, token, now, lease, cutoff) {
    const { data, error } = await table().update({ state: "sending", attempt_token: token, lease_until: lease })
      .eq("week_start", week).in("state", ["sending", "uncertain"])
      .lte("lease_until", now).gt("created_at", cutoff)
      .select("week_start").abortSignal(deadline()).maybeSingle();
    if (error) throw new Error("Delivery retry claim failed");
    return Boolean(data);
  },
  async finish(week, token, providerId) {
    const values = providerId
      ? { state: "accepted", provider_email_id: providerId, accepted_at: new Date().toISOString(), payload: null }
      : { state: "uncertain" };
    const { data, error } = await table().update(values)
      .eq("week_start", week).eq("attempt_token", token).eq("state", "sending")
      .select("week_start").abortSignal(deadline()).maybeSingle();
    if (error || !data) throw new Error("Delivery finalization failed");
  },
};
