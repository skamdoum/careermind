import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { reportSchema, reportingWeek } from "../../lib/beta-scorecard/report";

const root = mkdtempSync(join(tmpdir(), "cm-scorecard-"));
const data = join(root, "data");
const env = { ...process.env, PGHOST: root, PGPORT: "55479", PGUSER: "postgres", PGDATABASE: "postgres", PGPASSWORD: "" };
let started = false;
function command(bin: string, args: string[], input?: string) {
  return spawnSync(bin, args, { env, input, encoding: "utf8", timeout: 30000 });
}
function sql(query: string, failure?: RegExp) {
  const r = command("psql", ["-X", "-q", "-w", "-At", "--set", "ON_ERROR_STOP=1"], query);
  if (failure) { assert.notEqual(r.status, 0); assert.match(r.stderr, failure); }
  else assert.equal(r.status, 0, r.error?.message ?? r.stderr);
  return r.stdout.trim();
}
before(() => {
  const init = command("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "--no-locale"]);
  assert.equal(init.status, 0, init.error?.message ?? init.stderr);
  const boot = command("pg_ctl", ["-D", data, "-l", join(root, "log"), "-o", `-k ${root} -p 55479 -h ''`, "-w", "start"]);
  assert.equal(boot.status, 0, boot.stderr); started = true;
  sql(readFileSync("scripts/tests/ai-usage-fixture.sql", "utf8"));
  sql("alter table auth.users add column created_at timestamptz not null default now(), add column is_anonymous boolean not null default false;");
  sql(readFileSync("supabase/migrations/20261108000001_beta_telemetry.sql", "utf8"));
  sql(readFileSync("supabase/migrations/20261109000001_beta_scorecard.sql", "utf8"));
});
after(() => {
  if (started) command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(root, { recursive: true, force: true });
});
const week = reportingWeek(new Date()).weekStart;
const query = (external = "null", internal = "null") => `select public.beta_scorecard_report('${week}',${external},${internal});`;
for (const role of ["anon", "authenticated"]) {
  test(`${role} cannot access the reporting function or delivery rows`, () => {
    sql(`set role ${role};${query()}`, /permission denied for function/);
    sql(`set role ${role};select * from public.beta_scorecard_deliveries;`, /permission denied for table/);
    sql(`set role ${role};insert into public.beta_scorecard_deliveries default values;`, /permission denied for table/);
  });
}
test("service can aggregate registrations without access to raw Auth rows", () => {
  sql("set role service_role;select * from auth.users;", /permission denied/);
  const result = reportSchema.parse(JSON.parse(sql("set role service_role;" + query())));
  assert.equal(result.verified_beta_accounts, 0);
  assert.equal(result.periods[1].week_start, week);
  assert.equal(result.periods[1].cohorts.unclassified.known_spend_nanousd, null);
  assert.equal(result.periods[1].cohorts.unclassified.mean_latency_ms, null);
  sql("set role service_role;select public.beta_scorecard_report(current_date,null,null);", /Invalid scorecard report window/);
});
test("real report respects inclusive/exclusive local boundaries, cohort precedence and workflow coverage", () => {
  const [beta, internal, unclassified, anonymous, analysis, profile, investigation, uninitialized, compare] = Array.from({ length: 9 }, () => randomUUID());
  const start = `('${week}'::date::timestamp at time zone 'America/New_York')`;
  const end = `(('${week}'::date+7)::timestamp at time zone 'America/New_York')`;
  const inside = `${start}+interval '2 days'`;
  const call = (key: string, user: string, route: string, at: string, cost: string, opts: {
    analysis?: string; investigation?: string; operation?: string; index?: number; environment?: string; outcome?: string;
  } = {}) => `('${key}','ai_call',${at},'${user}','${opts.operation ?? randomUUID()}',${opts.index ?? 0},${opts.analysis ? `'${opts.analysis}'` : "null"},${opts.investigation ? `'${opts.investigation}'` : "null"},
    '${opts.environment ?? "production"}','${route}','gpt-4.1',20,0,10,'test',${cost},1000,'${opts.outcome ?? "success"}')`;
  sql(`insert into auth.users(id,created_at,is_anonymous)values
      ('${beta}',${start},false),('${internal}',${inside},false),('${unclassified}',${end},false),('${anonymous}',${inside},true);
    insert into public.profiles(id)values('${beta}');
    insert into public.career_profiles(id,user_id,name)values('${profile}','${beta}','Synthetic');
    insert into public.analyses(id,user_id,analysis_type,status,raw_json,created_at)values
      ('${analysis}','${beta}','initial_onboarding','completed','{}',${inside}),
      (gen_random_uuid(),'${beta}','initial_onboarding','completed','{}',${start}-interval '1 second'),
      (gen_random_uuid(),'${beta}','initial_onboarding','completed','{}',${end}),
      (gen_random_uuid(),'${beta}','initial_onboarding','failed','{}',${inside});
    insert into public.gap_investigations(id,user_id,career_profile_id,status)values
      ('${investigation}','${beta}','${profile}','concluded'),('${uninitialized}','${beta}','${profile}','active');
    insert into public.gap_investigation_turns(investigation_id,user_id,role,turn_index,structured,content,created_at)values
      ('${investigation}','${beta}','assistant',0,null,'private text',${inside}),
      ('${investigation}','${beta}','user',1,null,'private text',${inside}),
      ('${investigation}','${beta}','assistant',2,'{"action":"stop_and_conclude"}','private text',${inside});
    insert into public.telemetry_events(event_key,event_type,created_at,user_id,operation_id,call_index,analysis_id,investigation_id,
      environment,route,model,input_tokens,cached_input_tokens,output_tokens,pricing_version,estimated_cost_nanousd,latency_ms,outcome)values
      ${call("analysis", beta, "analysis", start, "10", { analysis })},
      ${call("kickoff", beta, "kickoff", inside, "20", { investigation })},
      ${call("turn", beta, "turn", inside, "null", { investigation, outcome: "unknown" })},
      ${call("compare-a", beta, "compare", inside, "30", { operation: compare })},
      ${call("compare-b", beta, "compare", inside, "40", { operation: compare, index: 1 })},
      ${call("preview", unclassified, "insights", inside, "999", { environment: "preview" })},
      ${call("internal", internal, "insights", inside, "50")},
      ${call("end", beta, "strategy", end, "999")};`);
  const raw = sql("set role service_role;" + query(`array['${beta}','${internal}','${anonymous}']::uuid[]`, `array['${internal}']::uuid[]`));
  const result = reportSchema.parse(JSON.parse(raw));
  assert.equal(result.verified_beta_accounts, 1);
  const c = result.periods[1].cohorts;
  assert.deepEqual([c.external_beta.registrations, c.external_beta.active_users, c.external_beta.analyses, c.external_beta.returning_analysis_users], [1, 1, 1, 1]);
  assert.deepEqual([c.external_beta.initialized_investigations, c.external_beta.investigations_with_replies, c.external_beta.concluded_investigations], [1, 1, 1]);
  assert.deepEqual([c.external_beta.calls, c.external_beta.known_spend_nanousd, c.external_beta.unknown_cost_calls, c.external_beta.unknown_outcome, c.external_beta.mean_latency_ms], [5, 100, 1, 1, 1000]);
  assert.deepEqual(c.external_beta.workflows.compare, { observed: 1, priced: 1, mean_cost_nanousd: 70 });
  assert.deepEqual(c.external_beta.workflows.investigation, { observed: 1, priced: 0, mean_cost_nanousd: null });
  assert.equal(c.internal_test.registrations, 1);
  assert.equal(c.internal_test.calls, 1);
  assert.equal(c.unclassified.active_users, 0);
  assert.equal(result.periods[0].cohorts.external_beta.analyses, 1);
  assert.doesNotMatch(raw, new RegExp(`private text|${beta}|${analysis}`));
});
test("database claim and retry compare-and-set allow only one winner", () => {
  const claim = `insert into public.beta_scorecard_deliveries(week_start,lease_until,attempt_token,state,payload)
    values('${week}',now()-interval '1 second',gen_random_uuid(),'sending','{}') on conflict(week_start)do nothing returning week_start;`;
  assert.equal(sql("set role service_role;" + claim), week);
  assert.equal(sql("set role service_role;" + claim), "");
  const retry = `update public.beta_scorecard_deliveries set state='sending',lease_until=now()+interval '2 minutes',attempt_token=gen_random_uuid()
    where week_start='${week}' and state in ('sending','uncertain') and lease_until<=now()
    and created_at>now()-interval '23 hours' returning week_start;`;
  assert.equal(sql("set role service_role;" + retry), week);
  assert.equal(sql("set role service_role;" + retry), "");
});
