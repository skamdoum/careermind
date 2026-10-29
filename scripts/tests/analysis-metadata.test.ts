/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase/router boundaries only; production page and metadata components run unchanged. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
let client: any, db: Record<string, any[]>, failTable: string | null;
let reads: Array<{ table: string; columns: string; filters: Record<string, unknown> }>;
const load = (Module as any)._load;
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (/lib\/supabase\/server(?:\.ts)?$/.test(name)) return { createClient: async () => client };
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(name) || name === "openai") throw new Error("Metadata display must not use privileged clients or AI");
  if (name === "next/navigation") return { redirect: (url: string) => { throw new Error(`redirect:${url}`); } };
  return load.call(this, name, ...args);
};
const { default: Page } = require("../../app/dashboard/[id]/page.tsx");
(Module as any)._load = load;
const { renderToStaticMarkup } = require("react-dom/server");

function reset() {
  reads = []; failTable = null;
  db = {
    profiles: [{ id: "owner", active_career_profile_id: "profile" }],
    career_profiles: [{ id: "profile", user_id: "owner" }],
    analyses: [{ id: "analysis-old", user_id: "owner", career_profile_id: "profile", career_goal_id: null,
      resume_id: "resume-old", job_description_id: "job-old", created_at: "2026-01-01T12:00:00Z",
      resume_name: "Generic legacy label", job_title: "Unverified legacy label",
      summary: "The original evaluation summary stays exactly as saved.",
      raw_json: { core_verdict: "Below Bar", company_name: "AI company is not a job title", gaps: [], signals: [] },
    }],
    resumes: [
      { id: "resume-old", user_id: "owner", career_profile_id: "profile", file_name: "Alex_Original_Resume_2026.pdf", created_at: "2026-01-01" },
      { id: "resume-new", user_id: "owner", career_profile_id: "profile", file_name: "Jordan_Latest_Upload.pdf", created_at: "2026-10-29" },
    ],
    job_descriptions: [
      { id: "job-old", user_id: "owner", career_profile_id: "profile", role_title: "Senior API Product Manager", created_at: "2026-01-01" },
      { id: "job-new", user_id: "owner", career_profile_id: "profile", role_title: "Principal Consumer PM", created_at: "2026-10-29" },
    ], plans: [], gaps: [],
  };
  client = { auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: (table: string) => {
    const filters: Record<string, unknown> = {}; let columns = "";
    const run = () => {
      reads.push({ table, columns, filters: { ...filters } });
      if (failTable === table) return { data: null, error: { message: "fixture metadata outage" } };
      return { data: structuredClone((db[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => row[key] === value))), error: null };
    };
    const q: any = {
      select: (value: string) => { columns = value; return q; },
      eq: (key: string, value: unknown) => { filters[key] = value; return q; }, order: () => q, limit: () => q,
      single: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
      maybeSingle: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (yes: any, no: any) => Promise.resolve(run()).then(yes, no),
      // No insert/update/delete/RPC/storage interface: writes/downloads fail.
    }; return q;
  } };
}
const render = async (id = "analysis-old") => renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }));

test("historical analysis displays its exact linked filename/title, never newer records or inferred labels", async () => {
  reset(); const before = JSON.stringify(db), html = await render();
  assert.match(html, /Alex_Original_Resume_2026\.pdf/); assert.match(html, /Senior API Product Manager/);
  for (const excluded of ["Jordan_Latest_Upload", "Principal Consumer PM", "Generic legacy label", "Unverified legacy label", "AI company is not a job title", "Latest uploaded resume", "Pasted job description"]) assert.ok(!html.includes(excluded));
  assert.match(html, /Below Bar/); assert.match(html, /The original evaluation summary stays exactly as saved/); assert.equal(JSON.stringify(db), before);
  assert.deepEqual(reads.find(r => r.table === "resumes"), { table: "resumes", columns: "file_name", filters: { id: "resume-old", user_id: "owner", career_profile_id: "profile" } });
  assert.deepEqual(reads.find(r => r.table === "job_descriptions"), { table: "job_descriptions", columns: "role_title", filters: { id: "job-old", user_id: "owner", career_profile_id: "profile" } });
});
test("different analyses in the same profile retain separate source associations", async () => {
  reset(); db.analyses.push({ ...db.analyses[0], id: "analysis-new", resume_id: "resume-new", job_description_id: "job-new" });
  const old = await render(), recent = await render("analysis-new");
  assert.match(old, /Alex_Original_Resume/); assert.ok(!old.includes("Jordan_Latest_Upload"));
  assert.match(recent, /Jordan_Latest_Upload/); assert.match(recent, /Principal Consumer PM/); assert.ok(!recent.includes("Alex_Original_Resume"));
});
test("reload keeps the same historical labels despite a newer upload", async () => {
  reset(); const first = await render();
  db.resumes.push({ ...db.resumes[1], id: "even-newer", file_name: "Another_Candidate.pdf", created_at: "2026-12-01" });
  assert.equal(await render(), first);
});
test("legacy analyses with absent source IDs get explicit fallback and do not query latest records", async () => {
  reset(); db.analyses[0].resume_id = null; db.analyses[0].job_description_id = null;
  const html = await render(); assert.match(html, /Resume filename unavailable for this analysis/); assert.match(html, /Target job title unavailable for this analysis/);
  assert.equal(reads.filter(r => r.table === "resumes" || r.table === "job_descriptions").length, 0);
  assert.ok(!html.includes("Unverified legacy label")); assert.ok(!html.includes("AI company is not a job title"));
});
test("deleted source records do not cause another candidate or job to be substituted", async () => {
  reset(); db.resumes.shift(); db.job_descriptions.shift(); const html = await render();
  assert.match(html, /Resume filename unavailable/); assert.match(html, /Target job title unavailable/);
  assert.ok(!html.includes("Jordan_Latest_Upload")); assert.ok(!html.includes("Principal Consumer PM"));
});
test("legacy linked rows without a matching profile scope use fallback instead of borrowing metadata", async () => {
  reset(); db.resumes[0].career_profile_id = null; db.job_descriptions[0].career_profile_id = null;
  const html = await render(); assert.match(html, /Resume filename unavailable/); assert.match(html, /Target job title unavailable/);
  assert.ok(!html.includes("Alex_Original_Resume")); assert.ok(!html.includes("Jordan_Latest_Upload"));
});
for (const value of [null, "", "   "]) test(`empty persisted metadata uses fallback (${JSON.stringify(value)})`, async () => {
  reset(); db.resumes[0].file_name = value; db.job_descriptions[0].role_title = value;
  const html = await render(); assert.match(html, /Resume filename unavailable/); assert.match(html, /Target job title unavailable/);
});
for (const table of ["resumes", "job_descriptions"]) for (const field of ["user_id", "career_profile_id"]) test(`${table} belonging to another ${field} cannot supply labels`, async () => {
  reset(); db[table][0][field] = "foreign"; const html = await render();
  if (table === "resumes") { assert.ok(!html.includes("Alex_Original_Resume")); assert.match(html, /Resume filename unavailable/); assert.match(html, /Senior API Product Manager/); }
  else { assert.ok(!html.includes("Senior API Product Manager")); assert.match(html, /Target job title unavailable/); assert.match(html, /Alex_Original_Resume/); }
});
for (const field of ["user_id", "career_profile_id"]) test(`analysis belonging to another ${field} is rejected before source lookup`, async () => {
  reset(); db.analyses[0][field] = "foreign"; const html = await render();
  assert.match(html, /Analysis not found/); assert.equal(reads.filter(r => r.table === "resumes" || r.table === "job_descriptions").length, 0);
});
test("unauthenticated visitors are redirected before any record lookup", async () => {
  reset(); client.auth.getUser = async () => ({ data: { user: null }, error: null });
  await assert.rejects(render(), /redirect:\/login/); assert.equal(reads.length, 0);
});
for (const table of ["resumes", "job_descriptions"]) test(`${table} read failure is visible and does not remove the saved verdict`, async () => {
  reset(); failTable = table; const html = await render();
  assert.match(html, /metadata temporarily unavailable/); assert.match(html, /Below Bar/); assert.match(html, /The original evaluation summary stays exactly as saved/);
  assert.ok(!html.includes("fixture metadata outage"));
});
test("original filenames and job titles render as escaped text with full hover labels", async () => {
  reset(); db.resumes[0].file_name = 'Original <Candidate> & portfolio.pdf'; db.job_descriptions[0].role_title = 'PM <script>alert(1)</script>';
  const html = await render(); assert.match(html, /Original &lt;Candidate&gt; &amp; portfolio\.pdf/); assert.ok(!html.includes("<script>"));
  assert.match(html, /title="Original &lt;Candidate&gt; &amp; portfolio\.pdf"/);
});
