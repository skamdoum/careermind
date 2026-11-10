import assert from "node:assert/strict";
import { test } from "node:test";
import { scorecardHandler, type Delivery, type ScorecardStore } from "../../lib/beta-scorecard/delivery";
import { formatScorecard, reportingWeek, type Scorecard } from "../../lib/beta-scorecard/report";

const secret = "synthetic-test-secret-with-32-characters";
const monday = "2026-11-09T14:00:00Z";
const week = "2026-11-02";
const cohort = {
  registrations: 0, active_users: 0, analyses: 0, returning_analysis_users: 0,
  initialized_investigations: 0, investigations_with_replies: 0, concluded_investigations: 0,
  calls: 0, unknown_cost_calls: 0, known_spend_nanousd: null, mean_latency_ms: null,
  rejected: 0, incomplete: 0, unknown_outcome: 0, unlinked_calls: 0, workflows: {},
};
const period = { starts_at: "", ends_at: "", cohorts: { external_beta: cohort, internal_test: cohort, unclassified: cohort } };
const report: Scorecard = { verified_beta_accounts: 2, periods: [
  { ...period, week_start: "2026-10-26" },
  { ...period, week_start: week, cohorts: { ...period.cohorts, external_beta: { ...cohort, analyses: 3 } } },
] };
function fixture() {
  let time = new Date(monday);
  const env = {
    VERCEL_ENV: "production", BETA_SCORECARD_SECRET: secret, BETA_SCORECARD_SEND_ENABLED: "true",
    BETA_SCORECARD_FROM: "reports@example.test", BETA_SCORECARD_TO: "operator@example.test",
    RESEND_API_KEY: "mock-key", BETA_SCORECARD_EXTERNAL_IDS: "[]", BETA_SCORECARD_INTERNAL_IDS: "[]",
  };
  const rows = new Map<string, Delivery>();
  const requests: { key: string | null; body: string }[] = [];
  const warnings: unknown[] = [];
  let failAcceptanceWrite = false;
  let timeout = false;
  let reports = 0;
  const store: ScorecardStore = {
    async report() { reports++; return structuredClone(report); },
    async find(key) { return structuredClone(rows.get(key) ?? null); },
    async claim(row) {
      if (rows.has(row.week_start)) return false;
      rows.set(row.week_start, { ...row, state: "sending", created_at: time.toISOString() });
      return true;
    },
    async reclaim(key, token, now, lease, cutoff) {
      const row = rows.get(key);
      if (!row || row.state === "accepted" || row.lease_until > now || row.created_at <= cutoff) return false;
      Object.assign(row, { state: "sending", attempt_token: token, lease_until: lease });
      return true;
    },
    async finish(key, token, providerId) {
      const row = rows.get(key)!;
      assert.equal(row.attempt_token, token);
      if (providerId && failAcceptanceWrite) throw new Error("private database error");
      row.state = providerId ? "accepted" : "uncertain";
      if (providerId) row.payload = null;
    },
  };
  const accepted = new Map<string, string>();
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    const key = new Headers(init?.headers).get("idempotency-key")!;
    const body = String(init?.body);
    requests.push({ key, body });
    if (accepted.has(key)) assert.equal(accepted.get(key), body);
    else accepted.set(key, body);
    if (timeout) throw new Error("private provider timeout");
    return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
  };
  const handle = scorecardHandler(store, { env, fetcher, now: () => time, warn: event => warnings.push(event) });
  return {
    env, rows, requests, accepted, warnings, reports: () => reports,
    setTime(value: string) { time = new Date(value); },
    failAcceptance() { failAcceptanceWrite = true; },
    timeout(value: boolean) { timeout = value; },
    run: (body: unknown = { mode: "schedule" }, auth = secret) => handle(new Request("https://app.example.test", {
      method: "POST", headers: { authorization: `Bearer ${auth}` }, body: JSON.stringify(body),
    })),
  };
}

test("New York scheduler and prior-week labels across spring and fall DST", () => {
  for (const [before, at, start, end] of [
    ["2026-03-09T12:59:59Z", "2026-03-09T13:00:00Z", "2026-03-02", "2026-03-08"],
    ["2026-11-02T13:59:59Z", "2026-11-02T14:00:00Z", "2026-10-26", "2026-11-01"],
  ]) {
    assert.equal(reportingWeek(new Date(before)).scheduleDue, false);
    assert.deepEqual(reportingWeek(new Date(at)), { weekStart: start, weekEnd: end, scheduleDue: true });
  }
  assert.equal(reportingWeek(new Date("2026-11-09T04:59:59Z")).weekStart, "2026-10-26");
  assert.throws(() => reportingWeek(new Date(monday), "2026-11-09"));
  assert.throws(() => reportingWeek(new Date(monday), "2026-11-03"));
});
test("email is aggregate-only, labels environments and cohorts, and preserves unknown spend", () => {
  const rendered = formatScorecard(report, reportingWeek(new Date(monday)));
  assert.match(rendered.subject, /2026-11-02 to 2026-11-08/);
  for (const body of [rendered.html, rendered.text]) {
    assert.match(body, /Verified external beta/);
    assert.match(body, /Internal\/test/);
    assert.match(body, /Unclassified/);
    assert.match(body, /Preview\/development/);
    assert.match(body, /Production AI/);
    assert.match(body, /— known estimated spend/);
    assert.match(body, /\+3 completed analyses/);
  }
  const hostile = { ...report, periods: [report.periods[0], { ...report.periods[1],
    cohorts: { ...report.periods[1].cohorts, external_beta: {
      ...cohort, workflows: { "<script>": { observed: 1, priced: 0, mean_cost_nanousd: null } },
    } },
  }] } as Scorecard;
  assert.doesNotMatch(formatScorecard(hostile, reportingWeek(new Date(monday))).html, /<script>/);
});
test("authorization, Preview, disabled sending, early schedule and dry run never claim or send", async () => {
  const f = fixture();
  assert.equal((await f.run(undefined, "invalid")).status, 401);
  f.env.VERCEL_ENV = "preview";
  assert.equal((await f.run()).status, 404);
  f.env.VERCEL_ENV = "production";
  f.setTime("2026-11-09T13:59:59Z");
  assert.equal((await (await f.run()).json()).result, "not_due");
  f.setTime(monday);
  f.env.BETA_SCORECARD_SEND_ENABLED = "false";
  assert.equal((await (await f.run()).json()).result, "sending_disabled");
  assert.equal((await (await f.run({ mode: "dry_run" })).json()).result, "dry_run_rendered");
  assert.equal(f.reports(), 1);
  assert.equal(f.rows.size, 0);
  assert.equal(f.requests.length, 0);
});
test("parallel triggers and later manual retries send one message for a week", async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 8 }, () => f.run()));
  assert.equal(f.requests.length, 1);
  assert.equal(f.rows.get(week)?.state, "accepted");
  assert.equal(f.rows.get(week)?.payload, null);
  f.setTime("2026-11-11T14:00:00Z");
  assert.equal((await (await f.run({ mode: "retry", week_start: week })).json()).result, "already_accepted");
  assert.equal(f.requests.length, 1);
});
test("ambiguous response reuses the frozen payload and key only in the safe window", async () => {
  const f = fixture();
  f.timeout(true);
  assert.equal((await f.run()).status, 502);
  assert.equal(f.rows.get(week)?.state, "uncertain");
  assert.equal((await f.run({ mode: "retry", week_start: week })).status, 409);
  f.setTime("2026-11-09T14:03:00Z");
  f.timeout(false);
  assert.equal((await (await f.run({ mode: "retry", week_start: week })).json()).result, "accepted");
  assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(f.accepted.size, 1);
  assert.equal(f.reports(), 1);
  assert.deepEqual(f.warnings, [{ event: "beta_scorecard_failed", week_start: week, stage: "provider" }]);
});
test("acceptance write failure does not permit resend past the provider safe window", async () => {
  const f = fixture();
  f.failAcceptance();
  assert.equal((await f.run()).status, 503);
  f.setTime("2026-11-10T13:00:00Z");
  assert.equal((await (await f.run({ mode: "retry", week_start: week })).json()).result, "reconciliation_required");
  assert.equal(f.requests.length, 1);
});
