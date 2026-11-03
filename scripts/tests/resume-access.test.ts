import { usageStoreDouble } from "./usage-store-double";
/* eslint-disable @typescript-eslint/no-explicit-any -- Only network boundaries are doubled; production handlers and guards execute. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const U = "11111111-1111-4111-8111-111111111111", P = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333", B = "44444444-4444-4444-8444-444444444444";
let db: Record<string, any[]>, downloads: string[], uploads: string[], generations: any[], reads: any[], writes: string[];
let claims = 0;
let user: any, failure: string | null, storageFailure: boolean, mutateOnDownloadRead: boolean;
const parsed = { positioning_summary: "Synthetic summary", core_verdict: "Borderline", signals: [], gaps: [], plan: { next_best_action: "Document evidence", tasks: [] } };
function query(table: string, admin = false) {
  const filters: Record<string, unknown> = {}; let limit = Infinity, inserted: any = null, sort = "";
  const result = () => {
    if (!admin) reads.push({ table, filters: { ...filters } });
    if (failure === table && !admin) return { data: null, error: { message: "fixture database failure" } };
    if (inserted) {
      const rows = (Array.isArray(inserted) ? inserted : [inserted]).map((row: any) => ({ ...row, id: row.id ?? `created-${table}` }));
      db[table] ??= []; db[table].push(...rows); inserted = null; return { data: rows, error: null };
    }
    let rows = (db[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
    if (sort) rows = [...rows].sort((a, b) => String(b[sort]).localeCompare(String(a[sort])));
    return { data: rows.slice(0, limit), error: null, count: rows.length };
  };
  const q: any = {
    select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
    order: (key: string) => { sort = key; return q; }, limit: (n: number) => { limit = n; return q; }, range: () => q,
    insert: (row: any) => { writes.push(table); inserted = row; return q; }, update: () => q,
    maybeSingle: async () => {
      // Model a metadata change between initial selection and privileged access.
      if (mutateOnDownloadRead && table === "resumes" && reads.some(r => r.table === "resumes")) db.resumes[0].file_path = `${B}/foreign.txt`;
      const r = result(); return { ...r, data: r.data?.[0] ?? null };
    },
    single: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
    then: (yes: any, no: any) => Promise.resolve(result()).then(yes, no),
  }; return q;
}
const client: any = { auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (table: string) => query(table) };
const load = (Module as any)._load;
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (/(?:ai-usage\/|\.\/)store\.server(?:\.ts)?$/.test(name)) {
    const store = usageStoreDouble(()=>client);
    return { usageRPC: (name: string, args: any) => { if(name === "ai_usage_claim") claims++; return store.usageRPC(name,args); } };
  }
  if (name === "server-only") return {};
  if (/lib\/supabase\/server(?:\.ts)?$/.test(name)) return { createClient: async () => client };
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(name)) return { supabaseAdmin: {
    from: (table: string) => query(table, true), storage: { from: (bucket: string) => {
      assert.equal(bucket, "resumes"); return { download: async (path: string) => {
        downloads.push(path); return { data: storageFailure ? null : new Blob(["Synthetic resume"]), error: storageFailure ? new Error("fixture") : null };
      } };
    } },
  } };
  if (name === "openai") return class {
    files = { create: async ({ file }: any) => { uploads.push(await file.text()); return { id: "file-test" }; } };
    responses = { create: async (input: any) => { generations.push(input); return { output_text: JSON.stringify(parsed) }; } };
  };
  if (/gap-investigation\/agent(?:\.ts)?$/.test(name)) return {
    assertAgentInputSize:()=>{},
    AGENT_MODEL_NAME: "fixture",
    uploadResumeFileForInvestigation: async ({ blob }: any) => { uploads.push(await blob.text()); return "file-test"; },
    runAgentTurn: async (input: any) => { generations.push(input); return { action: "ask_question", next_question: "What did you own?", candidate_evidence: [] }; },
  };
  return load.call(this, name, ...args);
};
const { POST: analyze } = require("../../app/api/analyze/route.ts");
const { POST: investigate } = require("../../app/api/gap-investigations/route.ts");
const { POST: register } = require("../../app/api/resumes/route.ts");
const { RESUME_SOURCE_KEY, textSource, textDigest } = require("../../lib/resumes/source.server.ts");
const { downloadOwnedResume } = require("../../lib/resumes/download.server.ts");
(Module as any)._load = load;
function reset() {
  claims = 0; downloads = []; uploads = []; generations = []; reads = []; writes = []; failure = null; storageFailure = false; mutateOnDownloadRead = false;
  user = { id: U, is_anonymous: false };
  db = {
    profiles: [{ id: U, active_career_profile_id: P }], career_profiles: [{ id: P, user_id: U }],
    resumes: [{ id: R, user_id: U, career_profile_id: P, file_path: `${U}/123.txt`, file_name: "synthetic.txt", mime_type: "text/plain", created_at: "2026-01-01" }],
    gaps: [{ id: "gap", analysis_id: "analysis", user_id: U, gap_title: "Evidence" }],
    analyses: [{ id: "analysis", user_id: U, career_profile_id: P, resume_id: R, raw_json: { [RESUME_SOURCE_KEY]: {version:1,kind:"stored",resume_id:R,sha256:textDigest("Synthetic resume")} } }], gap_investigations: [],
  };
}
const request = (body: unknown) => new Request("http://localhost/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const analysisBody = () => ({ resume_id: R, jobDescription: "Synthetic PM job", resumeText: "Must not bypass rejected file" });
const invBody = () => ({ gap_id: "gap" });
async function denied(handler: any, body: any, status: number) {
  const r = await handler(request(body)); assert.equal(r.status, status, JSON.stringify(await r.clone().json()));
  assert.equal((await r.json()).success, false); assert.deepEqual(downloads, []); assert.deepEqual(uploads, []); assert.deepEqual(generations, []); assert.deepEqual(writes, []);
}
for (const [label, handler, body] of [["analyze", analyze, analysisBody], ["investigate", investigate, invBody]] as const) {
  test(`${label}: unauthenticated rejects before any file or AI work`, async () => { reset(); user = null; await denied(handler, body(), 401); });
  for (const field of ["user_id", "career_profile_id"]) test(`${label}: exact resume ${field} isolation, no fallback`, async () => {
    reset(); db.resumes[0][field] = B;
    db.resumes.push({ ...db.resumes[0], id: "latest", user_id: U, career_profile_id: P, file_path: `${U}/new.txt`, created_at: "2027" });
    await denied(handler, body(), 404);
  });
  for (const path of [`${B}/foreign.txt`, `/${U}/x`, `${U}/../x`, `${U}/./x`, `${U}//x`, `${U}/%2e%2e/x`, `${U}/x?y`, `${U}/x#y`, `${U}/x\\y`, `${U}/x\n`, `${U}/x\0`, null, {}, U]) {
    test(`${label}: forged/malformed persisted path ${JSON.stringify(path)}`, async () => { reset(); db.resumes[0].file_path = path; await denied(handler, body(), 403); });
  }
  test(`${label}: ownership lookup failure fails closed`, async () => { reset(); failure = "resumes"; await denied(handler, body(), label === "analyze" ? 500 : 503); });
  if (label === "analyze") test(`${label}: freshly resolved metadata is revalidated before download`, async () => { reset(); mutateOnDownloadRead = true; await denied(handler, body(), 403); });
  test(`${label}: authorized canonical file and original contract`, async () => {
    reset(); const r = await handler(request(body())); assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    const json = await r.json(); assert.equal(json.success, true); assert.deepEqual(downloads, [`${U}/123.txt`]); assert.deepEqual(uploads, ["Synthetic resume"]); assert.equal(generations.length, 1);
    if (label === "analyze") { assert.deepEqual(json.data.result, parsed); assert.equal(json.data.analysisId, "created-analyses"); assert.equal(generations[0].input.some((i: any) => JSON.stringify(i).includes("Must not bypass")), false); }
    else assert.equal(json.data.investigation_id, "created-gap_investigations");
  });
  test(`${label}: anonymous Auth policy remains unchanged`, async () => { reset(); user.is_anonymous = true; const r = await handler(request(body())); assert.equal(r.status, 200); assert.equal(generations.length, 1); });
  test(`${label}: failed download never uploads or invokes AI`, async () => { reset(); storageFailure = true; const r = await handler(request(body())); assert.equal(r.status, label === "analyze" ? 500 : 409); assert.equal(downloads.length, 1); assert.deepEqual(uploads, []); assert.deepEqual(generations, []); });
}
for (const path of [`${B}/foreign.txt`, `${U}/../x`, `${U}/%2fsecret`, `${U}//x`, `${U}/x\0`, 42]) test(`registration rejects ${JSON.stringify(path)} without writes`, async () => { reset(); await denied(register, { filePath: path, fileName: "synthetic.txt" }, 403); });
test("registration preserves owned timestamp convention and server ownership", async () => { reset(); const r = await register(request({ filePath: `${U}/123.txt`, fileName: "synthetic.txt", user_id: B, career_profile_id: B })); assert.equal(r.status, 200); const row = (await r.json()).data; assert.equal(row.user_id, U); assert.equal(row.career_profile_id, P); assert.deepEqual(downloads, []); });
test("analyze latest fallback is scoped to the active user/profile", async () => { reset(); db.resumes.push({ ...db.resumes[0], id: "foreign-latest", user_id: B, created_at: "2027" }); const r = await analyze(request({ jobDescription: "Job" })); assert.equal(r.status, 200); assert.deepEqual(downloads, [`${U}/123.txt`]); });
test("analyze pasted text remains supported without a file", async () => { reset(); const r = await analyze(request({ resumeText: "Synthetic pasted text", jobDescription: "Job" })); assert.equal(r.status, 200); assert.deepEqual(downloads, []); assert.deepEqual(uploads, []); assert.equal(generations.length, 1); });
for (const reference of [{ resume_id: {} }, { resume_id: "" }, { latestResume: { file_path: `${B}/foreign.txt` } }, { resume_id: R, latestResume: { id: B } }]) test(`analyze malformed reference never falls back ${JSON.stringify(reference)}`, async () => { reset(); await denied(analyze, { ...analysisBody(), resume_id: undefined, ...reference }, 400); });
test("analyze legacy latestResume.id ignores forged client metadata", async () => { reset(); const r = await analyze(request({ latestResume: { id: R, file_path: `${B}/foreign.txt` }, jobDescription: "Job" })); assert.equal(r.status, 200); assert.deepEqual(downloads, [`${U}/123.txt`]); });
test("investigation missing explicit resume never substitutes a newer owned file", async () => { reset(); db.analyses[0].resume_id = "missing"; db.analyses[0].raw_json[RESUME_SOURCE_KEY].resume_id = "missing"; await denied(investigate, invBody(), 404); });
for (const withFile of [true, false]) test(`legacy missing source rejects before quota, stored files=${withFile}`, async () => {
  reset(); db.analyses[0].resume_id = null; db.analyses[0].raw_json = {}; if(!withFile)db.resumes=[];
  await denied(investigate,invBody(),409); assert.equal(claims,0);
});
test("pasted analysis persists private exact source and preserves public result", async () => {
  reset(); const text="  Synthetic pasted source  ";
  const r=await analyze(request({resumeText:text,jobDescription:"Job",[RESUME_SOURCE_KEY]:{kind:"stored",resume_id:B}}));
  const body=await r.json(); assert.equal(r.status,200); assert.deepEqual(body.data.result,parsed);
  const saved=db.analyses.at(-1)!; assert.deepEqual(saved.raw_json[RESUME_SOURCE_KEY],textSource(text));
  assert.equal(JSON.stringify(body).includes(text),false); assert.deepEqual(downloads,[]);
});
test("pasted investigation ignores other stored resumes and freezes original text", async () => {
  reset(); db.analyses[0].resume_id=null; db.analyses[0].raw_json[RESUME_SOURCE_KEY]=textSource("Original synthetic text");
  const r=await investigate(request(invBody())); assert.equal(r.status,200);
  assert.deepEqual(downloads,[]); assert.deepEqual(uploads,[]); assert.equal(generations.length,1);
  assert.deepEqual(generations[0].context.resume.source,textSource("Original synthetic text"));
  assert.deepEqual(db.gap_investigations[0].context_snapshot.resume.source,textSource("Original synthetic text"));
});
for (const source of [null,{}, {version:2,kind:"text",text:"Synthetic",sha256:"a".repeat(64)},
  {version:1,kind:"text",text:"Synthetic",sha256:"a".repeat(64)},
  {version:1,kind:"stored",resume_id:B,sha256:"a".repeat(64)},
  {version:1,kind:"text",text:"x".repeat(60001),sha256:"a".repeat(64)}]) test(`invalid/conflicting source rejects before quota (${JSON.stringify(source).slice(0,90)})`, async()=>{
  reset();db.analyses[0].raw_json[RESUME_SOURCE_KEY]=source; await denied(investigate,invBody(),409);assert.equal(claims,0);
});
test("changed file bytes reject before quota, upload or generation",async()=>{
  reset();db.analyses[0].raw_json[RESUME_SOURCE_KEY].sha256=textDigest("Different original bytes");
  const r=await investigate(request(invBody()));assert.equal(r.status,409);assert.equal(claims,0);assert.equal(downloads.length,1);assert.deepEqual(uploads,[]);assert.deepEqual(generations,[]);assert.deepEqual(writes,[]);
});
test("stored source uses exact analysis ID even with a newer owned resume",async()=>{
  reset();db.resumes.push({...db.resumes[0],id:"newer",file_path:`${U}/newer.txt`,created_at:"2027"});
  const r=await investigate(request(invBody()));assert.equal(r.status,200);assert.deepEqual(downloads,[`${U}/123.txt`]);
});
for (const field of ["user_id", "career_profile_id"]) test(`investigation originating analysis ${field} isolation`, async () => { reset(); db.analyses[0][field] = B; await denied(investigate, invBody(), 404); });
test("shared helper rejects a missing exact ID before querying", async () => { reset(); await assert.rejects(downloadOwnedResume(client, U, P, ""), (e: any) => e.status === 404); assert.deepEqual(reads, []); assert.deepEqual(downloads, []); });

test("model-authored reserved metadata is removed from public output and replaced by application source",async()=>{
  reset();(parsed as any)[RESUME_SOURCE_KEY]={version:1,kind:"text",text:"LLM INVENTED SOURCE"};
  try{
    const r=await analyze(request(analysisBody()));assert.equal(r.status,200);const body=await r.json();
    assert.equal(body.data.result[RESUME_SOURCE_KEY],undefined);
    assert.equal(db.analyses.at(-1)!.raw_json[RESUME_SOURCE_KEY].kind,"stored");
    assert.equal(JSON.stringify(body).includes("LLM INVENTED SOURCE"),false);
  }finally{delete (parsed as any)[RESUME_SOURCE_KEY];}
});
