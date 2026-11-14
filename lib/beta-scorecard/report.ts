import { z } from "zod";

const ny = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23",
});
const dayMs = 86_400_000;
export function reportingWeek(now: Date, requested?: string) {
  const parts = Object.fromEntries(ny.formatToParts(now).map(({ type, value }) => [type, value]));
  // Use UTC only for arithmetic on calendar labels. Postgres independently
  // resolves both local midnights to real instants in America/New_York.
  const local = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  const weekday = (local.getUTCDay() + 6) % 7;
  const latest = +local - (weekday + 7) * dayMs;
  const weekStart = requested ?? new Date(latest).toISOString().slice(0, 10);
  const parsed = new Date(`${weekStart}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !Number.isFinite(+parsed)
    || parsed.toISOString().slice(0, 10) !== weekStart || parsed.getUTCDay() !== 1
    || +parsed > latest || +parsed < +local - 77 * dayMs) throw new Error("Invalid reporting week");
  return {
    weekStart,
    weekEnd: new Date(+parsed + 6 * dayMs).toISOString().slice(0, 10),
    scheduleDue: weekday === 0 && Number(parts.hour) >= 9,
  };
}

const count = z.number().int().nonnegative();
const nullable = z.number().nonnegative().nullable();
const cohort = z.object({
  registrations: count, active_users: count, analyses: count, returning_analysis_users: count,
  initialized_investigations: count, investigations_with_replies: count, concluded_investigations: count,
  calls: count, unknown_cost_calls: count, known_spend_nanousd: nullable, mean_latency_ms: nullable,
  rejected: count, incomplete: count, unknown_outcome: count, unlinked_calls: count,
  workflows: z.record(z.string(), z.object({ observed: count, priced: count, mean_cost_nanousd: nullable })),
});
const period = z.object({
  week_start: z.string(), starts_at: z.string(), ends_at: z.string(),
  cohorts: z.object({ external_beta: cohort, internal_test: cohort, unclassified: cohort }),
});
export const reportSchema = z.object({ verified_beta_accounts: count, periods: z.tuple([period, period]) });
export type Scorecard = z.infer<typeof reportSchema>;

const cohorts = [
  ["external_beta", "Verified external beta"], ["internal_test", "Internal/test"], ["unclassified", "Unclassified"],
] as const;
const workflowLabels = {
  analysis: "Analysis", compare: "Comparison", investigation: "Investigation",
  recommendation: "Recommendation", insights: "Insights", strategy: "Strategy",
};
const money = (nano: number | null) => nano === null ? "—" : `$${(nano / 1e9).toFixed(6)}`;
const change = (n: number) => n > 0 ? `+${n}` : String(n);
const escape = (s: string) => s.replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function formatScorecard(report: Scorecard, week: ReturnType<typeof reportingWeek>) {
  const [previous, current] = report.periods;
  if (current.week_start !== week.weekStart) throw new Error("Mismatched scorecard week");
  const beta = current.cohorts.external_beta;
  const prior = previous.cohorts.external_beta;
  const subject = `CareerMind beta scorecard | ${week.weekStart} to ${week.weekEnd}`;
  const summary = `${report.verified_beta_accounts} verified external beta accounts on the current roster. `
    + `External beta vs. prior week: ${change(beta.active_users - prior.active_users)} active users, `
    + `${change(beta.analyses - prior.analyses)} completed analyses, `
    + `${change(beta.unknown_cost_calls - prior.unknown_cost_calls)} calls with unknown cost.`;
  const sections = cohorts.map(([key, label]) => {
    const c = current.cohorts[key];
    const adoption = `${c.registrations} new registrations · ${c.active_users} weekly active · ${c.analyses} completed analyses · ${c.returning_analysis_users} returning analysis users`;
    const gaps = `${c.initialized_investigations} investigations initialized · ${c.investigations_with_replies} with replies · ${c.concluded_investigations} concluded`;
    const ai = `${money(c.known_spend_nanousd)} known estimated spend · ${c.calls} recorded calls · ${c.unknown_cost_calls} unknown cost · ${c.unlinked_calls} unlinked · ${c.mean_latency_ms === null ? "—" : (c.mean_latency_ms / 1000).toFixed(2) + "s"} mean provider latency`;
    const errors = `${c.rejected} rejected · ${c.incomplete} incomplete · ${c.unknown_outcome} unknown outcome`;
    const workflows = Object.entries(workflowLabels).flatMap(([route, name]) => {
      const w = c.workflows[route];
      return w ? [`${name}: ${money(w.mean_cost_nanousd)} mean (${w.priced}/${w.observed} observed groups priced and linked)`] : [];
    });
    return { label, adoption, gaps, ai, errors, workflows };
  });
  const notes = [
    "Reporting week: Monday through Sunday, America/New_York. Cohorts use the current verified roster for both weeks.",
    "Business records are shared across environments and may include Preview/development activity. Weekly active users include qualifying persisted business activity or a recorded Production AI call. Returning analysis users have a completed analysis on an earlier local date.",
    "AI telemetry is Production-only and best effort. Known spend is an estimate, not billing. Workflow means cover observed calls this week with known costs and required links, not lifetime costs. Recommendations are separate. Missing telemetry is not zero.",
  ];
  return {
    subject,
    html: `<div style="font:15px/1.5 system-ui,sans-serif;max-width:680px;margin:auto;color:#172238"><h1>${escape(subject)}</h1><p>${escape(summary)}</p>`
      + sections.map(s => `<h2>${escape(s.label)}</h2><p><strong>Adoption:</strong> ${escape(s.adoption)}<br>${escape(s.gaps)}</p><p><strong>Production AI:</strong> ${escape(s.ai)}<br>${escape(s.errors)}</p>`
        + (s.workflows.length ? `<ul>${s.workflows.map(line => `<li>${escape(line)}</li>`).join("")}</ul>` : "")).join("")
      + notes.map(note => `<p><small>${escape(note)}</small></p>`).join("") + "</div>",
    text: [subject, summary, ...sections.flatMap(s => [
      s.label, `Adoption: ${s.adoption}`, s.gaps, `Production AI: ${s.ai}`, s.errors, ...s.workflows,
    ]), ...notes].join("\n\n"),
  };
}
