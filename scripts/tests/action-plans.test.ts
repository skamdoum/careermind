/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase network-boundary doubles; production handlers, reader and UI are imported unchanged. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
let client: any;
const originalLoad = (Module as any)._load;
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (/lib\/supabase\/server(?:\.ts)?$/.test(name)) return { createClient: async () => client };
  return originalLoad.call(this, name, ...args);
};
const { GET } = require("../../app/api/action-plans/route.ts");
const { PATCH } = require("../../app/api/tasks/[id]/route.ts");
(Module as any)._load = originalLoad;
const { loadActionPlans, saveTaskStatus } = require("../../lib/action-plans/client.ts");
const { ActionPlanView } = require("../../app/dashboard/ActionPlan.tsx");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
let db: Record<string, any[]>;
let failure: string | null;
let queries: string[];
function reset() {
  failure = null; queries = [];
  db = {
    profiles: [{ id: "owner", active_career_profile_id: "profile" }],
    career_profiles: [{ id: "profile", user_id: "owner" }],
    career_goals: [{ id: "g1", title: "Platform search", user_id: "owner", career_profile_id: "profile" }, { id: "g2", title: "Other search", user_id: "owner", career_profile_id: "profile" }],
    job_descriptions: [{ id: "j1", career_goal_id: "g1", role_title: "Platform PM", company_name: "Acme", user_id: "owner", career_profile_id: "profile" }],
    analyses: [{ id: "a1", user_id: "owner", career_profile_id: "profile", career_goal_id: "g1", job_description_id: "j1", created_at: "2026-10-26T12:00:00Z" }, { id: "a2", user_id: "owner", career_profile_id: "profile", career_goal_id: "g2", job_description_id: null, created_at: "2026-10-25T12:00:00Z" }],
    plans: [{ id: "p1", user_id: "owner", analysis_id: "a1", next_best_action: "Document scope" }, { id: "p2", user_id: "owner", analysis_id: "a2", next_best_action: "Prepare stories" }],
    plan_tasks: [{ id: "t1", user_id: "owner", plan_id: "p1", title: "Document platform ownership", description: "Write two concrete bullets.", priority: 1, status: "not_started" }, { id: "t2", user_id: "owner", plan_id: "p2", title: "Prepare a story", description: null, priority: 2, status: "done" }],
  };
  client = { auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: (table: string) => {
    queries.push(table);
    const filters: Array<(row: any) => boolean> = [];
    const order: Array<{ key: string; ascending: boolean }> = [];
    let patch: any = null;
    let range: [number, number] | null = null;
    const execute = () => {
      if (failure === table) return { data: null, error: { message: "fixture database outage" } };
      let selected = (db[table] ?? []).filter(row => filters.every(fn => fn(row)));
      selected = [...selected].sort((a, b) => { for (const sort of order) { const n = a[sort.key] < b[sort.key] ? -1 : a[sort.key] > b[sort.key] ? 1 : 0; if (n) return sort.ascending ? n : -n; } return 0; });
      if (range) selected = selected.slice(range[0], range[1] + 1);
      if (patch) selected.forEach(row => Object.assign(row, patch));
      return { data: selected, error: null };
    };
    const q: any = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; },
      order: (key: string, options?: { ascending?: boolean }) => { order.push({ key, ascending: options?.ascending !== false }); return q; },
      range: (from: number, to: number) => { range = [from, to]; return q; },
      update: (value: any) => { patch = value; return q; },
      maybeSingle: async () => { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; },
      single: async () => { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
    };
    return q;
  } };
}
const request = (status: string) => new Request("http://localhost/api/tasks/t1", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
const update = (id: string, status: string) => PATCH(request(status), { params: Promise.resolve({ id }) });
const data = async () => { const r = await GET(); assert.equal(r.status, 200); return (await r.json()).data; };
const html = (value: unknown, props = {}) => renderToStaticMarkup(React.createElement(ActionPlanView, { data: value, onStatusChange: () => {}, ...props }));

test("GET rejects unauthenticated users before reading tables", async () => {
  reset(); client.auth.getUser = async () => ({ data: { user: null }, error: null });
  assert.equal((await GET()).status, 401); assert.deepEqual(queries, []);
});
test("plans and tasks are selected through owned analyses in the active profile", async () => {
  reset();
  db.analyses.push({ ...db.analyses[0], id: "foreign", user_id: "other" }, { ...db.analyses[0], id: "other-profile", career_profile_id: "old" });
  db.plans.push({ id: "p-foreign", user_id: "other", analysis_id: "a1" }, { id: "p-old", user_id: "owner", analysis_id: "other-profile" });
  db.plan_tasks.push({ ...db.plan_tasks[0], id: "t-foreign", user_id: "other" }, { ...db.plan_tasks[0], id: "t-old", plan_id: "p-old" });
  const result = await data(), serialized = JSON.stringify(result);
  for (const id of ["foreign", "other-profile", "p-foreign", "p-old", "t-foreign", "t-old"]) assert.ok(!serialized.includes(`\"${id}\"`));
  assert.equal(result.groups[0].jobs[0].analyses[0].plans[0].tasks[0].id, "t1");
  assert.equal(result.groups[1].jobs[0].analyses[0].plans[0].tasks[0].id, "t2");
});
test("same-title goals stay separate; multiple analyses and plans are not collapsed", async () => {
  reset(); db.career_goals[1].title = db.career_goals[0].title;
  db.analyses.push({ ...db.analyses[0], id: "a3", created_at: "2026-10-24" });
  db.plans.push({ id: "p3", user_id: "owner", analysis_id: "a1" }, { id: "p4", user_id: "owner", analysis_id: "a3" });
  const result = await data(); assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups[0].jobs[0].analyses.map((a: any) => a.id), ["a1", "a3"]);
  assert.deepEqual(result.groups[0].jobs[0].analyses[0].plans.map((p: any) => p.id), ["p1", "p3"]);
});
test("foreign or mismatched metadata never provides a goal/job label or link", async () => {
  reset(); db.career_goals[0].user_id = "other"; db.job_descriptions[0].career_goal_id = "g2";
  const result = await data(); assert.equal(result.groups[0].goal.title, "Career goal unavailable");
  assert.equal(result.groups[0].goal.href, null); assert.equal(result.groups[0].jobs[0].title, "Target job unavailable");
  assert.equal(result.groups[0].jobs[0].href, null);
});
test("empty analyses, missing plans and empty plans render distinct states", async () => {
  reset(); db.analyses = []; assert.match(html(await data()), /Your action plan is built from analyses/);
  reset(); db.plans = []; assert.match(html(await data()), /No saved plan for this analysis/);
  reset(); db.plan_tasks = []; assert.match(html(await data()), /No tasks in this plan/);
});
test("read failures return an error instead of an empty successful plan", async () => {
  reset(); failure = "plan_tasks"; const response = await GET(); assert.equal(response.status, 500);
  assert.equal((await response.json()).success, false);
});
test("reader paginates analyses rather than truncating the history", async () => {
  reset(); db.analyses = Array.from({ length: 501 }, (_, i) => ({ ...db.analyses[0], id: `analysis-${i}` })); db.plans = [];
  const result = await data(); assert.equal(result.groups[0].jobs[0].analyses.length, 501);
});
test("existing PATCH persists all supported statuses and reload returns the stored value", async () => {
  reset();
  for (const status of ["in_progress", "done", "not_started"]) {
    const r = await update("t1", status); assert.equal(r.status, 200);
    const fresh = await data(); assert.equal(fresh.groups[0].jobs[0].analyses[0].plans[0].tasks[0].status, status);
  }
});
test("PATCH rejects foreign tasks, foreign plans and other-profile analyses without writes", async () => {
  for (const target of ["task", "plan", "profile"]) {
    reset();
    if (target === "task") db.plan_tasks[0].user_id = "other";
    if (target === "plan") db.plans[0].user_id = "other";
    if (target === "profile") db.analyses[0].career_profile_id = "other-profile";
    assert.equal((await update("t1", "done")).status, 404); assert.equal(db.plan_tasks[0].status, "not_started");
  }
});
test("PATCH rejects missing tasks, invalid statuses and logged-out users", async () => {
  reset(); assert.equal((await update("missing", "done")).status, 404);
  assert.equal((await update("t1", "new")).status, 400);
  client.auth.getUser = async () => ({ data: { user: null }, error: null });
  assert.equal((await update("t1", "done")).status, 401);
  assert.equal(db.plan_tasks[0].status, "not_started");
});
test("production client loads fresh data, saves through PATCH and renders persisted status on reload", async () => {
  reset(); const prior = globalThis.fetch;
  globalThis.fetch = (async (url: string, options?: RequestInit) => {
    if (url === "/api/action-plans") { assert.equal(options?.cache, "no-store"); return GET(); }
    assert.equal(url, "/api/tasks/t1"); assert.equal(options?.method, "PATCH");
    return update("t1", JSON.parse(String(options?.body)).status);
  }) as typeof fetch;
  try {
    const initial = await loadActionPlans(); assert.match(html(initial), /<option value="new" selected="">/);
    assert.equal((await saveTaskStatus("t1", "done")).status, "done");
    const reloaded = await loadActionPlans();
    const markup = html(reloaded); assert.match(markup, /100% complete/); assert.match(markup, /2 of 2 done/);
    assert.match(markup, /<option value="done" selected="">/);
    assert.match(markup, /Platform search/); assert.match(markup, /Platform PM · Acme/); assert.match(markup, /Write two concrete bullets/);
  } finally { globalThis.fetch = prior; }
});
test("failed client status save throws and preserves the stored status", async () => {
  reset(); const prior = globalThis.fetch;
  globalThis.fetch = (async () => { failure = "plan_tasks"; return update("t1", "done"); }) as typeof fetch;
  try { await assert.rejects(() => saveTaskStatus("t1", "done")); assert.equal(db.plan_tasks[0].status, "not_started"); }
  finally { globalThis.fetch = prior; }
});
test("saving task disables its controls and shows only its error", async () => {
  reset(); const markup = html(await data(), { saving: ["t1"], taskErrors: { t1: "Save failed" } });
  assert.match(markup, /<fieldset disabled=""/); assert.match(markup, /Saving…/); assert.match(markup, /role="alert"[^>]*>Save failed/);
});

test("failed reload with previously loaded data shows the error and retry cannot reveal stale tasks", async () => {
  reset();
  const savedData = await data();
  const states: any[] = [savedData, "Reload failed", 0, [], {}];
  let hook = 0;
  const path = require.resolve("../../app/dashboard/ActionPlan.tsx");
  const cached = require.cache[path];
  const loader = (Module as any)._load;
  // Supply React hook state at the failed-reload boundary. The production
  // component, error branch, retry callback and rendered children run unchanged.
  const hooks = {
    ...React,
    useState: () => {
      const index = hook++;
      return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef: () => ({ current: new Set() }),
    useEffect: () => {},
  };
  delete require.cache[path];
  (Module as any)._load = function(name: string, ...args: unknown[]) {
    return name === "react" ? hooks : loader.call(this, name, ...args);
  };
  try {
    const Component = require(path).default;
    const element = Component();
    const markup = renderToStaticMarkup(element);
    assert.match(markup, /Could not load your action plan/);
    assert.match(markup, /Reload failed/);
    assert.ok(!markup.includes("Document platform ownership"));
    assert.ok(!markup.includes("Platform search"));
    element.props.action.props.onClick();
    assert.equal(states[0], null); assert.equal(states[1], null); assert.equal(states[2], 1);
    hook = 0;
    const retryMarkup = renderToStaticMarkup(Component());
    assert.match(retryMarkup, /Loading action plan/);
    assert.ok(!retryMarkup.includes("Document platform ownership"));
  } finally {
    (Module as any)._load = loader;
    if (cached) require.cache[path] = cached; else delete require.cache[path];
  }
});
