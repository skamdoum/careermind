/* eslint-disable @typescript-eslint/no-explicit-any -- Network-boundary doubles only; production reader/evaluator/validator/route/UI execute unchanged. */
import assert from "node:assert/strict";
import { createRequire, default as Module } from "node:module";
import { test } from "node:test";
import { normalizeEvidence, validateRecommendation } from "../../lib/gap-investigation/plan-recommendation";
import { goldenCases } from "../eval/plan-recommendations/cases";

const require = createRequire(import.meta.url);
let client: any, output: any, providerCalls = 0, providerOptions: any, providerRequest: any;
class Provider {
  constructor(options: unknown) { providerOptions = options; }
  responses = { create: async (request: any) => { providerCalls++; providerRequest = request; return { output_text: JSON.stringify(typeof output === "function" ? output() : output) }; } };
}
const loader = (Module as any)._load;
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (name === "openai") return Provider;
  if (/lib\/supabase\/server(?:\.ts)?$/.test(name)) return { createClient: async () => client };
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(name)) throw new Error("Read-only evaluator must not import admin client");
  return loader.call(this, name, ...args);
};
const { POST } = require("../../app/api/gap-investigations/[id]/action-plan-recommendation/route.ts");
(Module as any)._load = loader;
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const { default: Section, RecommendationResult } = require("../../app/dashboard/gap-investigations/[id]/plan-recommendation.tsx");
let db: Record<string, any[]>, queries: string[], failTable: string | null;
const baseInput = goldenCases[0].input;
function model() { return { outcome: "FULL_MATCH", assessed_dimensions: { underlying_capability: "demonstrated", resume_evidence: "partial", target_role_fit: "meets" }, matches: [{ task_id: "t1", coverage_reason: "Documents ownership decisions and outcomes" }], remaining_need: null, proposed_task: null, rationale: "Existing resume task covers the remaining documentation need, without establishing resolution.", grounding: [{ evidence_id: "e1", quote: baseInput.evidence[0].claim }] }; }
function reset() {
  providerCalls = 0; queries = []; failTable = null; output = model();
  db = {
    profiles: [{ id: "owner", active_career_profile_id: "profile" }], career_profiles: [{ id: "profile", user_id: "owner" }],
    gap_investigations: [{ id: "inv", user_id: "owner", career_profile_id: "profile", status: "concluded", seed_analysis_id: "analysis", context_snapshot: { target: baseInput.target, gap: { gap_title: baseInput.finding.title } }, ...baseInput.finding.reported_dimensions, residual_gap: baseInput.finding.reported_residual_gap }],
    analyses: [{ id: "analysis", user_id: "owner", career_profile_id: "profile", raw_json: { role_requirements: baseInput.target.requirements.map(requirement => ({ requirement, evidence: ["Unconfirmed old assessment"], assessment: "met" })) } }],
    plans: [{ id: "p1", analysis_id: "analysis", user_id: "owner" }],
    plan_tasks: baseInput.plans[0].tasks.map(task => ({ ...task, user_id: "owner" })),
    gap_investigation_evidence: [{ id: "e1", investigation_id: "inv", user_id: "owner", user_status: "confirmed", user_edit: null, claim: baseInput.evidence[0].claim, source_type: "user" }],
  };
  client = { auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: (table: string) => {
    queries.push(table); const filters: Array<(row: any) => boolean> = []; let range = [0, Infinity];
    const run = () => ({ data: structuredClone((db[table] ?? []).filter(row => filters.every(filter => filter(row))).sort((a,b) => a.id.localeCompare(b.id)).slice(range[0], range[1] + 1)), error: failTable === table ? { message: "outage" } : null });
    const q: any = { select: () => q, eq: (k: string, v: unknown) => { filters.push(row => row[k] === v); return q; }, in: (k: string, v: unknown[]) => { filters.push(row => v.includes(row[k])); return q; }, order: () => q, range: (a: number,b: number) => { range=[a,b]; return q; }, maybeSingle: async () => { const result=run(); return { ...result, data: result.data[0] ?? null }; }, then: (resolve: any,reject: any) => Promise.resolve(run()).then(resolve,reject) };
    // Deliberately no insert/update/delete/RPC methods: any write fails the test.
    return q;
  } };
}
const invoke = () => POST(new Request("http://localhost/api/recommend", { method: "POST", body: JSON.stringify({ plan_id: "foreign", profile_id: "foreign", evidence: ["invented"] }) }), { params: Promise.resolve({ id: "inv" }) });

test("session auth is required before data reads or AI", async () => {
  reset(); client.auth.getUser = async () => ({ data: { user: null }, error: null }); assert.equal((await invoke()).status,401); assert.equal(queries.length,0); assert.equal(providerCalls,0);
});
for (const field of ["user_id","career_profile_id","status","seed_analysis_id"]) test(`investigation rejects invalid ${field} without AI`,async()=>{
  reset(); db.gap_investigations[0][field] = field === "status" ? "active" : field === "seed_analysis_id" ? null : "foreign";
  assert.ok([404,409].includes((await invoke()).status)); assert.equal(providerCalls,0);
});
for (const kind of ["missing-pointer","foreign-profile","missing-seed","foreign-seed","other-profile-seed"]) test(`scope fails closed: ${kind}`,async()=>{
  reset();
  if(kind === "missing-pointer") db.profiles[0].active_career_profile_id=null;
  if(kind === "foreign-profile") db.career_profiles[0].user_id="other";
  if(kind === "missing-seed") db.analyses=[];
  if(kind === "foreign-seed") db.analyses[0].user_id="other";
  if(kind === "other-profile-seed") db.analyses[0].career_profile_id="other";
  assert.equal((await invoke()).status,409); assert.equal(providerCalls,0);
});
test("only exact seed-analysis owned plans/tasks are read, including done tasks and all plans",async()=>{
  reset(); db.plan_tasks[0].status="done";
  db.plans.push({ id:"p2",analysis_id:"analysis",user_id:"owner" },{id:"foreign-plan",analysis_id:"analysis",user_id:"other"},{id:"other-analysis-plan",analysis_id:"different-analysis",user_id:"owner"});
  db.plan_tasks.push({...db.plan_tasks[0],id:"t2",plan_id:"p2"},{...db.plan_tasks[0],id:"foreign-task",user_id:"other"},{...db.plan_tasks[0],id:"other-task",plan_id:"other-analysis-plan"});
  const before=JSON.stringify(db); const response=await invoke(); assert.equal(response.status,200);
  const result=(await response.json()).data; assert.equal(result.matches[0].task_id,"t1");assert.equal(result.matches[0].status,"done"); assert.equal(result.matches[0].plan_id,"p1");
  const sent=JSON.parse(providerRequest.input[1].content); assert.deepEqual(sent.plans.map((p:any)=>p.id),["p1","p2"]);
  const serialized=JSON.stringify(sent);for(const term of ["foreign-task","foreign-plan","other-analysis-plan","other-task","Unconfirmed old assessment"])assert.ok(!serialized.includes(term));
  assert.equal(JSON.stringify(db),before); assert.equal(providerOptions.maxRetries,0); assert.equal(providerOptions.timeout,60000);
});
test("edited text replaces the old claim; old dimensions/residual and pending/rejected evidence never reach the model",async()=>{
  reset(); db.gap_investigation_evidence[0].user_status="edited";db.gap_investigation_evidence[0].claim="SUPERSEDED CLAIM";db.gap_investigation_evidence[0].user_edit=baseInput.evidence[0].claim;
  db.gap_investigation_evidence.push({...db.gap_investigation_evidence[0],id:"pending",user_status:"pending",user_edit:null,claim:"UNCONFIRMED CLAIM"},{...db.gap_investigation_evidence[0],id:"rejected",user_status:"rejected",user_edit:null,claim:"REJECTED CLAIM"});
  assert.equal((await invoke()).status,200);const sent=JSON.parse(providerRequest.input[1].content);
  assert.equal(sent.finding.reported_dimensions,null);assert.equal(sent.finding.reported_residual_gap,null);
  for(const term of ["SUPERSEDED CLAIM","UNCONFIRMED CLAIM","REJECTED CLAIM"])assert.ok(!JSON.stringify(sent).includes(term));
});
test("no validated evidence and empty edited claims return explicit grounding errors before AI",async()=>{
  for(const invalid of ["pending","edited"]) {reset();db.gap_investigation_evidence[0].user_status=invalid;db.gap_investigation_evidence[0].user_edit="";const response=await invoke();assert.equal(response.status,422);assert.equal((await response.json()).error,"insufficient_grounding");assert.equal(providerCalls,0);}
});
test("missing/empty plans produce a read-only no-match proposal",async()=>{
  for(const missing of [true,false]) { reset();if(missing)db.plans=[];else db.plan_tasks=[];output={...model(),outcome:"NO_MATCH",matches:[],remaining_need:"Document API decisions",proposed_task:{title:"Document API decisions",description:"Write two resume bullets showing the API tradeoff and measured outcome.",task_type:"resume"}};
    const response=await invoke();assert.equal(response.status,200);assert.equal((await response.json()).data.plan_availability,missing?"missing":"empty"); }
});
test("source changes during generation reject stale output",async()=>{
  reset();output=()=>{db.plan_tasks[0].status="done";return model();};const response=await invoke();assert.equal(response.status,409);assert.equal((await response.json()).error,"assessment_stale");
});
test("database errors fail closed before provider work",async()=>{reset();failTable="plans";assert.equal((await invoke()).status,503);assert.equal(providerCalls,0);});

for(const outcome of ["FULL_MATCH","PARTIAL_MATCH","NO_MATCH","NO_ACTION_NEEDED"]) test(`deterministic contract accepts ${outcome} (not a model-quality result)`,()=>{
  const raw:any=model();raw.outcome=outcome;
  if(outcome==="PARTIAL_MATCH"||outcome==="NO_MATCH"){raw.remaining_need="Document ownership";raw.proposed_task={title:"Record ownership",description:"Write a concrete API roadmap decision bullet.",task_type:"resume"};}
  if(outcome==="NO_MATCH"||outcome==="NO_ACTION_NEEDED")raw.matches=[];
  if(outcome==="NO_ACTION_NEEDED")raw.assessed_dimensions.resume_evidence="demonstrates";
  const result=validateRecommendation(baseInput,raw);assert.equal(result.outcome,outcome);assert.equal(result.investigation_id,"inv");assert.match(result.source_hash,/^[a-f0-9]{64}$/);
});
for(const invalid of ["foreign-task","duplicate-task","foreign-evidence","false-quote","no-citations","full-with-proposal","partial-without-proposal","no-match-with-matches","no-action-with-gap","forged-status","insufficient","unknown-axis","extra-field","duplicate-proposal"]) test(`deterministic validator rejects ${invalid}`,()=>{
  const raw:any=model();
  if(invalid==="foreign-task")raw.matches[0].task_id="foreign";
  if(invalid==="duplicate-task")raw.matches.push(raw.matches[0]);
  if(invalid==="foreign-evidence")raw.grounding[0].evidence_id="foreign";
  if(invalid==="false-quote")raw.grounding[0].quote="Invented achievement of a billion dollars";
  if(invalid==="no-citations")raw.grounding=[];
  if(invalid==="full-with-proposal")raw.proposed_task={title:"Extra",description:"Invent extra work",task_type:"resume"};
  if(invalid==="partial-without-proposal")raw.outcome="PARTIAL_MATCH";
  if(invalid==="no-match-with-matches")raw.outcome="NO_MATCH";
  if(invalid==="no-action-with-gap")raw.outcome="NO_ACTION_NEEDED";
  if(invalid==="forged-status")raw.matches[0].status="done";
  if(invalid==="insufficient")raw.outcome="INSUFFICIENT_EVIDENCE";
  if(invalid==="unknown-axis")raw.assessed_dimensions.resume_evidence="unknown";
  if(invalid==="extra-field")raw.plan_id="attacker";
  if(invalid==="duplicate-proposal"){raw.outcome="NO_MATCH";raw.matches=[];raw.remaining_need="Document resume";raw.proposed_task={title:baseInput.plans[0].tasks[0].title,description:baseInput.plans[0].tasks[0].description,task_type:"resume"};}
  assert.throws(()=>validateRecommendation(baseInput,raw));
});
test("normalizer excludes pending/rejected and cannot fall back from blank edited text",()=>{
  assert.deepEqual(normalizeEvidence([{id:"e",claim:"Original",user_status:"edited",user_edit:"Corrected text",source_type:"user"},{id:"p",claim:"Not established",user_status:"pending",user_edit:null,source_type:"user"}]),[{id:"e",claim:"Corrected text",source_type:"user"}]);
  assert.throws(()=>normalizeEvidence([{id:"e",claim:"Original",user_status:"edited",user_edit:"",source_type:"user"}]));
});
test("UI initially makes no request and exposes no accept or mutation controls",()=>{
  let calls=0;const prior=globalThis.fetch;globalThis.fetch=(async()=>{calls++;throw new Error("No auto generation");}) as typeof fetch;
  try {const html=renderToStaticMarkup(React.createElement(Section,{investigationId:"inv"}));assert.match(html,/Check existing actions/);assert.match(html,/Action Plan has not been modified/);assert.ok(!html.includes("Accept"));assert.equal(calls,0);}finally{globalThis.fetch=prior;}
});
test("result UI shows actual done status without declaring the gap resolved",()=>{
  const input=structuredClone(baseInput);input.plans[0].tasks[0].status="done";const result=validateRecommendation(input,model());
  const html=renderToStaticMarkup(React.createElement(RecommendationResult,{result}));assert.match(html,/Done/);assert.match(html,/does not establish that the career gap is resolved/);assert.ok(!html.includes("Suggested task:"));
});

test("incomplete target context fails with a grounding error before AI",async()=>{
  reset();db.analyses[0].raw_json.role_requirements=null;const response=await invoke();assert.equal(response.status,422);assert.equal(providerCalls,0);
});
test("shortened or spliced quotations are not accepted as verbatim support",()=>{
  const raw=model();raw.grounding[0].quote="I independently owned an API product roadmap ... measured adoption outcome.";
  assert.throws(()=>validateRecommendation(baseInput,raw));
});
test("fully satisfied dimensions cannot return a full-match result instead of no-action",()=>{
  const raw=model();raw.assessed_dimensions.resume_evidence="demonstrates";assert.throws(()=>validateRecommendation(baseInput,raw));
});
test("bounded evaluator rejects oversized inputs without provider work",async()=>{
  reset();db.gap_investigation_evidence[0].claim="x".repeat(61000);const response=await invoke();assert.equal(response.status,413);assert.equal(providerCalls,0);
});
test("all task pages are included, not only the first response page",async()=>{
  reset();db.plan_tasks.push(...Array.from({length:101},(_,index)=>({...db.plan_tasks[0],id:`extra-${index}`})));
  assert.equal((await invoke()).status,200);assert.equal(JSON.parse(providerRequest.input[1].content).plans[0].tasks.length,102);
});

test("task status never enters model input, but server returns the current status",async()=>{
  reset();db.plan_tasks[0].status="done";const response=await invoke();assert.equal(response.status,200);
  const sent=JSON.parse(providerRequest.input[1].content);assert.equal(sent.plans[0].tasks[0].status,undefined);assert.equal((await response.json()).data.matches[0].status,"done");
});
test("empty task set restricts the provider schema to non-match outcomes",async()=>{
  reset();db.plans=[];output={...model(),outcome:"NO_MATCH",matches:[],remaining_need:"Document ownership",proposed_task:{title:"Document decisions",description:"Record the API decisions in the resume.",task_type:"resume"}};
  assert.equal((await invoke()).status,200);assert.deepEqual(providerRequest.text.format.schema.properties.outcome.enum,["NO_MATCH","NO_ACTION_NEEDED","INSUFFICIENT_EVIDENCE"]);
});

test("endpoint rejects invalid/unsupported model output without returning a recommendation",async()=>{
  reset();output={...model(),matches:[{task_id:"another-analysis-task",coverage_reason:"Wrong scope"}]};
  const response=await invoke(),body=await response.json();assert.equal(response.status,502);assert.equal(body.error,"invalid_assessment");assert.equal(body.data,undefined);
});
test("provider failures are sanitized and perform no database writes",async()=>{
  reset();const before=JSON.stringify(db);output=()=>{throw new Error("sensitive provider details");};
  const response=await invoke(),body=await response.json();assert.equal(response.status,503);assert.ok(!JSON.stringify(body).includes("sensitive"));assert.equal(JSON.stringify(db),before);
});

test("provider schema grounds candidate facts first and selects the outcome last",async()=>{
  reset();assert.equal((await invoke()).status,200);
  const keys=Object.keys(providerRequest.text.format.schema.properties);
  assert.equal(keys[0],"grounding");assert.equal(keys.at(-1),"outcome");
  assert.ok(keys.indexOf("assessed_dimensions")<keys.indexOf("matches"));
});
test("edited capability deficit cannot be labeled no-action even with a correct explanation and proposal",()=>{
  const input=goldenCases.find(row=>row.id==="edited-capability")!.input;
  const raw={...model(),outcome:"NO_ACTION_NEEDED",assessed_dimensions:{underlying_capability:"not_demonstrated",resume_evidence:"does_not_demonstrate",target_role_fit:"does_not_meet"},matches:[],remaining_need:"Acquire independent API ownership",proposed_task:{title:"Own an API roadmap decision",description:"Seek an opportunity to independently own API roadmap decisions and measure the outcome.",task_type:"strategy"},grounding:[{evidence_id:"e1",quote:input.evidence[0].claim}]};
  assert.throws(()=>validateRecommendation(input,raw));
  // The same supported deficit is valid when classified consistently; no repair
  // or relabeling of invalid model output happens in the production validator.
  assert.equal(validateRecommendation(input,{...raw,outcome:"NO_MATCH"}).outcome,"NO_MATCH");
});
test("partial-match task exclusions cannot masquerade as candidate evidence",()=>{
  const input=goldenCases.find(row=>row.id==="partial-ownership")!.input;
  const raw={...model(),outcome:"PARTIAL_MATCH",remaining_need:"Document measured API adoption outcomes",proposed_task:{title:"Document adoption outcome",description:"Add the measured API launch adoption outcome to the resume.",task_type:"resume"}};
  assert.equal(validateRecommendation(input,raw).outcome,"PARTIAL_MATCH");
  raw.grounding.push({evidence_id:"e1",quote:"adoption metrics are explicitly outside this task."});
  assert.throws(()=>validateRecommendation(input,raw));
});
