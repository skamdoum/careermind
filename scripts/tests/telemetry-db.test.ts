import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { providerEvent } from "../../lib/ai-usage/telemetry";

const root = mkdtempSync(join(tmpdir(), "cm-telemetry-"));
const env = { ...process.env, PGHOST: root, PGPORT: "55475", PGUSER: "postgres", PGDATABASE: "postgres", PGPASSWORD: "" };
let started = false;
function command(bin: string, args: string[], input?: string) {
  return spawnSync(bin, args, { env, input, encoding: "utf8", timeout: 30000 });
}
function sql(query: string, ok = true) {
  const r = command("psql", ["-X", "-q", "-w", "-At", "--set", "ON_ERROR_STOP=1"], query);
  if (ok) assert.equal(r.status, 0, r.error?.message ?? r.stderr);
  else assert.notEqual(r.status, 0);
  return r.stdout.trim();
}
before(() => {
  const init = command("initdb", ["-D", join(root, "data"), "-U", "postgres", "-A", "trust", "--no-locale"]);
  assert.equal(init.status, 0, init.error?.message ?? init.stderr);
  const boot = command("pg_ctl", ["-D", join(root, "data"), "-l", join(root, "log"), "-o", `-k ${root} -p 55475 -h ''`, "-w", "start"]);
  assert.equal(boot.status, 0, boot.stderr); started = true;
  sql(readFileSync("scripts/tests/ai-usage-fixture.sql", "utf8"));
  sql(readFileSync("supabase/migrations/20261103000001_ai_usage_guard.sql", "utf8"));
  sql(readFileSync("supabase/migrations/20261108000001_beta_telemetry.sql", "utf8"));
});
after(() => {
  if (started) command("pg_ctl", ["-D", join(root, "data"), "-m", "immediate", "-w", "stop"]);
  rmSync(root, { recursive: true, force: true });
});
const event = providerEvent({ operationId: randomUUID(), userId: randomUUID(), callIndex: 0, route: "analysis", latencyMs: 9,
  model: "gpt-4.1", outcome: "success", responseId: "resp_test", usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 4 } } }, "preview");
function insert(row = event) {
  const value = JSON.stringify({ ...row, id: randomUUID(), created_at: new Date().toISOString() }).replaceAll("'", "''");
  return `insert into public.telemetry_events select (jsonb_populate_record(null::public.telemetry_events,'${value}'::jsonb)).*`;
}
test("server inserts; event key and receipt identities deduplicate independently", () => {
  sql(`set role service_role;${insert()};`);
  sql(`set role service_role;${insert()} on conflict(event_key)do nothing;`);
  assert.equal(sql("select count(*) from public.telemetry_events"), "1");
  sql(insert({ ...event, event_key: "different", operation_id: randomUUID() }), false);
  sql(insert({ ...event, event_key: "another", provider_response_id: "resp_different" }), false);
});
for (const role of ["anon", "authenticated"]) test(`${role} cannot read or mutate telemetry`, () => {
  for (const query of ["select * from public.telemetry_events", insert({ ...event, event_key: role }),
    "update public.telemetry_events set outcome='unknown'", "delete from public.telemetry_events"])
    sql(`set role ${role};${query}`, false);
});
test("RLS is enabled and no browser policies exist", () => {
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.telemetry_events'::regclass"), "t");
  assert.equal(sql("select count(*)from pg_policies where tablename='telemetry_events'and schemaname='public'"), "0");
});
test("numeric checks reject negative tokens and impossible cached counts", () => {
  const fresh = { ...event, event_key: randomUUID(), operation_id: randomUUID(), provider_response_id: null };
  sql(insert({ ...fresh, input_tokens: -1 }), false);
  sql(insert({ ...fresh, cached_input_tokens: 11 }), false);
});
test("existing guard pruning deletes an old operation without deleting telemetry", () => {
  sql(`insert into public.ai_usage_operations(id,user_id,request_key,fingerprint,route,category,units,day,state,owner,lease_until,ceiling,remaining,updated_at)
    values('${event.operation_id}','${event.user_id}',repeat('a',64),repeat('b',64),'analysis','analysis',1,current_date,'complete',gen_random_uuid(),now(),2170000,0,now()-interval '25 hours');`);
  sql(`set role service_role;select public.ai_usage_claim('${event.user_id}',repeat('c',64),repeat('d',64),'analysis',1);`);
  assert.equal(sql("select count(*) from public.ai_usage_operations"), "0");
  assert.equal(sql("select count(*) from public.telemetry_events"), "1");
});
test("weekly report separates verified cohorts and filters only telemetry by environment", () => {
  const [beta, internal, unclassified, previewOnly] = Array.from({ length: 4 }, () => randomUUID());
  const report = readFileSync("docs/beta-telemetry.sql", "utf8").match(/with cohorts as \([\s\S]+?;/)?.[0];
  assert.ok(report);
  const configured = report
    .replace("array[]::uuid[] as external_beta_ids", `array['${beta}','${internal}','${previewOnly}']::uuid[] as external_beta_ids`)
    .replace("array[]::uuid[] as internal_test_ids", `array['${internal}']::uuid[] as internal_test_ids`);
  const activity = (user_id: string, environment: string) => insert({
    ...event, user_id, environment, event_key: randomUUID(), operation_id: randomUUID(), provider_response_id: null,
  });
  const values = [beta, unclassified].map(id => `('${id}')`).join(",");
  const actual = sql(`begin;delete from public.telemetry_events;
    insert into auth.users(id)values${values};
    insert into public.profiles(id)values${values};
    insert into public.analyses(user_id,analysis_type,raw_json)
      select id,'initial_onboarding','{}'::jsonb from public.profiles where id in ('${beta}','${unclassified}');
    ${activity(beta, "production")};${activity(internal, "production")};${activity(previewOnly, "preview")};
    ${configured}rollback;`);
  assert.deepEqual(actual.split("|").slice(1), ["1", "1", "1"]);
});
