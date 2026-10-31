/* eslint-disable @typescript-eslint/no-explicit-any -- Network and React-hook boundaries only; real readers, handlers and components run. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import { existingActiveProfile, readSavedInvestigations, investigationsForGap } from "../../lib/gap-investigation/saved";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
let client: any, db: Record<string, any[]>, failure: string | null, calls: number, writes: number, agentFailure: boolean;
let navigations: string[] = [];
const load = (Module as any)._load;
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (/lib\/supabase\/server(?:\.ts)?$/.test(name)) return { createClient: async () => client };
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(name)) return { supabaseAdmin: { from: (table: string) => client.from(table) } };
  if (/gap-investigation\/agent(?:\.ts)?$/.test(name)) return {
    AGENT_MODEL_NAME: "test",
    uploadResumeFileForInvestigation: async () => { calls++; throw new Error("Unexpected upload"); },
    runAgentTurn: async () => { calls++; if (agentFailure) throw new Error("Fixture agent failure"); return { action: "ask_question", next_question: "Saved first question", candidate_evidence: [] }; },
  };
  if (name === "next/navigation") return { useRouter: () => ({ push: (url: string) => navigations.push(url) }), redirect: (url: string) => { throw new Error(`redirect:${url}`); } };
  return load.call(this, name, ...args);
};
const { POST } = require("../../app/api/gap-investigations/route.ts");
const { GET } = require("../../app/api/gap-investigations/[id]/route.ts");
const { default: DetailPage } = require("../../app/dashboard/gap-investigations/[id]/page.tsx");
const { default: AnalysisPage } = require("../../app/dashboard/[id]/page.tsx");
// Hook stub lets us invoke the actual click callback twice before a rerender.
// This is not browser hydration coverage; JSX rendering still uses real React.
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (name === "next/navigation") return { useRouter: () => ({ push: (url: string) => navigations.push(url) }) };
  if (name === "react") return { ...React, useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, () => {}] };
  return load.call(this, name, ...args);
};
// AnalysisPage has already cached this module with real hooks. Reload only it.
delete require.cache[require.resolve("../../app/dashboard/[id]/investigate-gap-button.tsx")];
const { default: Button } = require("../../app/dashboard/[id]/investigate-gap-button.tsx");
(Module as any)._load = load;

function reset() {
  failure = null; calls = 0; writes = 0; agentFailure = false; navigations = [];
  db = {
    profiles: [{ id: "owner", active_career_profile_id: "profile" }],
    career_profiles: [{ id: "profile", user_id: "owner" }],
    analyses: [{ id: "analysis", user_id: "owner", career_profile_id: "profile", raw_json: { gaps: [{ gap_title: "Ownership", severity: "High" }] } }],
    gaps: [{ id: "gap", user_id: "owner", analysis_id: "analysis", priority: 1, gap_title: "Ownership" }],
    gap_investigations: [{ id: "saved", user_id: "owner", career_profile_id: "profile", seed_gap_id: "gap", seed_analysis_id: "analysis", status: "concluded", created_at: "2026-10-28", context_snapshot: { gap: { gap_title: "Ownership" } }, conclusion: "capability_gap", conclusion_summary: "Saved conclusion" }],
    gap_investigation_turns: [{ id: "turn", investigation_id: "saved", user_id: "owner", role: "assistant", turn_index: 0, content: "Saved first question" }],
    gap_investigation_evidence: [{ id: "evidence", investigation_id: "saved", user_id: "owner", user_status: "edited", claim: "Old claim", user_edit: "Corrected evidence" }],
  };
  client = { auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: (table: string) => {
    const filters: Array<(row: any) => boolean> = [], sorts: any[] = [];
    let range = [0, Infinity], inserted: any[] | null = null;
    const run = () => {
      if (failure === table) return { data: null, error: { message: "fixture read failure" } };
      if (inserted) { db[table] ??= []; db[table].push(...inserted); inserted = null; }
      const data = (db[table] ?? []).filter(row => filters.every(f => f(row))).sort((a, b) => {
        for (const [key, ascending] of sorts) { const n = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; if (n) return ascending ? n : -n; } return 0;
      }).slice(range[0], range[1] + 1);
      return { data: structuredClone(data), error: null };
    };
    const q: any = {
      select: () => q, eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return q; },
      in: (key: string, values: unknown[]) => { filters.push(r => values.includes(r[key])); return q; },
      order: (key: string, options?: { ascending?: boolean }) => { sorts.push([key, options?.ascending !== false]); return q; },
      limit: (n: number) => { range = [0, n - 1]; return q; }, range: (from: number, to: number) => { range = [from, to]; return q; },
      insert: (row: any) => { writes++; inserted = [{ ...row, id: `created-${writes}` }]; return q; },
      maybeSingle: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
      single: async () => { const r = run(); return { ...r, data: r.data?.at(-1) ?? null }; },
      then: (yes: any, no: any) => Promise.resolve(run()).then(yes, no),
      // No delete/update methods: unintended cleanup or profile writes fail.
    }; return q;
  } };
}
const post = () => POST(new Request("http://localhost/api/gap-investigations", { method: "POST", body: JSON.stringify({ gap_id: "gap" }) }));
const get = () => GET(new Request("http://localhost/api/gap-investigations/saved"), { params: Promise.resolve({ id: "saved" }) });

test("discovery selects exact user/profile/analysis/gap and keeps all historical statuses", async () => {
  reset(); const original = db.gap_investigations[0];
  db.gap_investigations.push(...["user_id", "career_profile_id", "seed_analysis_id", "seed_gap_id"].map(key => ({ ...original, id: key, [key]: "foreign" })));
  db.gap_investigations.push({ ...original, id: "abandoned", status: "abandoned" });
  const result = investigationsForGap(await readSavedInvestigations(client, "owner", "profile", "analysis"), "gap");
  assert.deepEqual(result.history.map(r => r.id), ["saved", "abandoned"]); assert.equal(result.primary?.id, "saved");
});
test("active first, then newest concluded; ties use descending ID; input is unchanged", () => {
  reset(); const rows = [{ ...db.gap_investigations[0], id: "z", status: "active", created_at: "2026-10-01" }, { ...db.gap_investigations[0], id: "a", status: "active", created_at: "2026-10-01" }, db.gap_investigations[0]];
  const before = JSON.stringify(rows); assert.equal(investigationsForGap(rows, "gap").primary?.id, "z"); assert.equal(JSON.stringify(rows), before);
});
test("discovery paginates so older history is not silently hidden", async () => {
  reset(); db.gap_investigations.push(...Array.from({ length: 103 }, (_, i) => ({ ...db.gap_investigations[0], id: `history-${i}` })));
  assert.equal((await readSavedInvestigations(client, "owner", "profile", "analysis")).length, 104);
});
for (const status of ["active", "concluded"]) test(`creation POST reuses ${status} with no AI or writes`, async () => {
  reset(); db.gap_investigations[0].status = status; const before = JSON.stringify(db);
  const response = await post(); assert.equal(response.status, 200); assert.equal((await response.json()).data.investigation_id, "saved");
  assert.equal(calls, 0); assert.equal(writes, 0); assert.equal(JSON.stringify(db), before);
});
test("reload returns the same saved turns, conclusion and edited/confirmed evidence", async () => {
  reset(); db.gap_investigation_evidence.push({ ...db.gap_investigation_evidence[0], id: "confirmed", user_status: "confirmed", user_edit: null });
  const before = JSON.stringify(db), first = await (await get()).json(), second = await (await get()).json();
  assert.deepEqual(first, second); assert.deepEqual(first.data.turns, db.gap_investigation_turns);
  assert.deepEqual(first.data.evidence, db.gap_investigation_evidence); assert.equal(first.data.investigation.conclusion_summary, "Saved conclusion");
  assert.equal(calls, 0); assert.equal(writes, 0); assert.equal(JSON.stringify(db), before);
});
for (const field of ["user_id", "career_profile_id"]) test(`saved detail and GET reject foreign ${field}`, async () => {
  reset(); db.gap_investigations[0][field] = "foreign"; assert.equal((await get()).status, 404);
  const html = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "saved" }) })); assert.match(html, /Investigation not found/); assert.ok(!html.includes("Saved conclusion"));
});
test("missing/foreign active pointer never creates a profile or opens saved data", async () => {
  for (const value of [null, "foreign"]) { reset(); db.profiles[0].active_career_profile_id = value;
    assert.equal(await existingActiveProfile(client, "owner"), null); assert.equal((await get()).status, 404); assert.equal((await post()).status, 409); assert.equal(calls, 0); assert.equal(writes, 0); }
});
test("unauthenticated callers cannot read, create or navigate to saved data", async () => {
  reset(); client.auth.getUser = async () => ({ data: { user: null }, error: null });
  assert.equal((await post()).status, 401); assert.equal((await get()).status, 401);
  await assert.rejects(DetailPage({ params: Promise.resolve({ id: "saved" }) }), /redirect:\/login/); assert.equal(calls, 0);
});
test("incomplete initialization is preserved and produces an explicit reload path without AI", async () => {
  reset(); db.gap_investigation_turns = []; const before = JSON.stringify(db);
  assert.equal((await post()).status, 409); assert.equal((await get()).status, 409);
  const html = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "saved" }) }));
  assert.match(html, /has not finished initializing/); assert.match(html, /Reload investigation/); assert.ok(!html.includes("Type your answer"));
  assert.equal(JSON.stringify(db), before); assert.equal(calls, 0); assert.equal(writes, 0);
});
test("failed discovery does not offer creation as though there were no saved records", async () => {
  reset(); failure = "gap_investigations";
  const html = renderToStaticMarkup(await AnalysisPage({ params: Promise.resolve({ id: "analysis" }) }));
  assert.match(html, /Saved investigations could not be loaded/); assert.ok(!html.includes("Investigate this gap"));
  assert.equal((await post()).status, 500); assert.equal(calls, 0); assert.equal(writes, 0);
});
test("analysis page renders saved navigation rather than a creation button", async () => {
  reset(); const html = renderToStaticMarkup(await AnalysisPage({ params: Promise.resolve({ id: "analysis" }) }));
  assert.match(html, /View investigation/); assert.match(html, /href="\/dashboard\/gap-investigations\/saved"/); assert.ok(!html.includes("Investigate this gap")); assert.equal(calls, 0);
});
test("saved controls link directly, expose abandoned history and perform no requests", () => {
  reset(); const rows = [db.gap_investigations[0], { ...db.gap_investigations[0], id: "abandoned", status: "abandoned" }];
  const html = renderToStaticMarkup(React.createElement(Button, { gapId: "gap", saved: investigationsForGap(rows, "gap") }));
  assert.match(html, /View investigation/); assert.match(html, /abandoned/); assert.match(html, /Investigation history \(2\)/); assert.ok(!html.includes("<button"));
  rows[0].status = "active"; assert.match(renderToStaticMarkup(React.createElement(Button, { gapId: "gap", saved: investigationsForGap(rows, "gap") })), /Continue investigation/);
});
test("rapid clicks before rerender send one POST and navigate once", async () => {
  reset(); let requests = 0, finish: any; const original = globalThis.fetch;
  globalThis.fetch = (() => { requests++; return new Promise(resolve => { finish = resolve; }); }) as typeof fetch;
  try {
    const tree = Button({ gapId: "gap", saved: { primary: null, history: [] } });
    const button = tree.props.children.find((child: any) => child?.type === "button"); assert.ok(button);
    const first = button.props.onClick(); await button.props.onClick(); assert.equal(requests, 1);
    finish(new Response(JSON.stringify({ success: true, data: { investigation_id: "saved" } }))); await first;
    assert.deepEqual(navigations, ["/dashboard/gap-investigations/saved"]);
  } finally { globalThis.fetch = original; }
});
test("failed creation permits an explicit retry", async () => {
  reset(); const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response(JSON.stringify({ success: false, error: "Temporary error" }), { status: 503 }); }) as typeof fetch;
  try { const tree = Button({ gapId: "gap", saved: { primary: null, history: [] } }); const button = tree.props.children.find((child: any) => child?.type === "button"); await button.props.onClick(); await button.props.onClick(); assert.equal(requests, 2); }
  finally { globalThis.fetch = original; }
});
test("new investigations still persist the first turn and a retry reuses that record", async () => {
  reset(); db.gap_investigations = []; db.gap_investigation_turns = [];
  const first = await (await post()).json(); assert.equal(first.success, true); assert.equal(calls, 1); assert.equal(writes, 2);
  const second = await (await post()).json(); assert.equal(second.data.investigation_id, first.data.investigation_id); assert.equal(calls, 1); assert.equal(writes, 2);
});
test("kickoff failure keeps the row and subsequent retries do not silently regenerate", async () => {
  reset(); db.gap_investigations = []; db.gap_investigation_turns = []; agentFailure = true;
  assert.equal((await post()).status, 502); assert.equal(db.gap_investigations.length, 1); assert.equal(calls, 1);
  assert.equal((await post()).status, 409); assert.equal(calls, 1); assert.equal(writes, 1);
});
test("abandoned-only history stays visible without being resumed", () => {
  reset(); db.gap_investigations[0].status = "abandoned";
  const saved = investigationsForGap(db.gap_investigations, "gap"); assert.equal(saved.primary, null);
  const html = renderToStaticMarkup(React.createElement(Button, { gapId: "gap", saved }));
  assert.match(html, /Investigate this gap/); assert.match(html, /abandoned/); assert.match(html, /\/dashboard\/gap-investigations\/saved/);
});
test("analysis with no history offers investigation creation", async () => {
  reset(); db.gap_investigations = [];
  const html = renderToStaticMarkup(await AnalysisPage({ params: Promise.resolve({ id: "analysis" }) }));
  assert.match(html, /Investigate this gap/); assert.ok(!html.includes("View investigation")); assert.equal(calls, 0); assert.equal(writes, 0);
});
for (const kind of ["foreign-gap", "foreign-analysis", "other-profile-analysis"]) test(`creation rejects ${kind} before reuse or AI`, async () => {
  reset(); if (kind === "foreign-gap") db.gaps[0].user_id = "foreign";
  if (kind === "foreign-analysis") db.analyses[0].user_id = "foreign";
  if (kind === "other-profile-analysis") db.analyses[0].career_profile_id = "other";
  assert.equal((await post()).status, 404); assert.equal(calls, 0); assert.equal(writes, 0);
});
test("profile lookup failures do not fall back or expose saved bundles", async () => {
  reset(); failure = "career_profiles";
  assert.equal((await get()).status, 500); assert.equal((await post()).status, 500); assert.equal(calls, 0); assert.equal(writes, 0);
});
test("deleted seed-gap references stay accessible as analysis history without gap substitution", async () => {
  reset(); db.gap_investigations[0].seed_gap_id = null;
  const html = renderToStaticMarkup(await AnalysisPage({ params: Promise.resolve({ id: "analysis" }) }));
  assert.match(html, /Other saved investigations from this analysis \(1\)/);
  assert.match(html, /\/dashboard\/gap-investigations\/saved/); assert.match(html, /Investigate this gap/);
});
test("concluded and abandoned detail pages render saved content without starting AI", async () => {
  for (const status of ["concluded", "abandoned"]) {
    reset(); db.gap_investigations[0].status = status;
    const html = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "saved" }) }));
    assert.match(html, /Saved first question/); assert.match(html, /Corrected evidence/);
    assert.ok(!html.includes("Type your answer"));
    if (status === "concluded") assert.match(html, /Saved conclusion/);
    else assert.match(html, /This investigation is abandoned/);
    assert.equal(calls, 0); assert.equal(writes, 0);
  }
});
