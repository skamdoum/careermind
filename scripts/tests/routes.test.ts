/* eslint-disable @typescript-eslint/no-explicit-any -- Structural test doubles and CJS network-boundary injection; production logic is imported unchanged. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";

// Module mocks replace only the session client and provider. Real handlers,
// authorization helpers, operation lifecycle and normalization are imported.
const require = createRequire(import.meta.url);
let client: any;
let providerCalls = 0;
let uploadCalls = 0;
let output: unknown = {};
let providerError: unknown = null;
let uploaded: unknown;
let providerInput: any;
class Provider {
  files = { create: async (args: unknown) => { uploadCalls++; uploaded=args; return {id:"file-owned"}; } };
  responses = { create: async (input: unknown) => { providerInput=input; providerCalls++; if(providerError) throw providerError; return {output_text:JSON.stringify(output)}; } };
}
// Preserve actual SDK error constructors used by the production classifier.
const realOpenAI = require("openai");
Object.assign(Provider, realOpenAI.default ?? realOpenAI);
Object.assign(Provider, { default: Provider, OpenAI: Provider });
// tsx resolves package conditions differently from Node's experimental module
// mocking. Intercept these three CJS network boundaries before loading handlers.
const originalLoad = (Module as any)._load;
(Module as any)._load = function(specifier: string, ...args: unknown[]) {
  if (specifier === "server-only") return {};
  if (specifier === "openai") return Provider;
  if (/lib\/supabase\/server(?:\.ts)?$/.test(specifier)) return {createClient:async()=>client};
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(specifier)) return {supabaseAdmin:{rpc:(...rpcArgs: any[])=>client.trustedRpc(...rpcArgs)}};
  return originalLoad.call(this, specifier, ...args);
};

const calls: Array<{name:string;args:any}> = [];
let tables: Record<string,any>={};
let rpcResults: Record<string,any>={};
const downloads: string[]=[];
function reset() {
  calls.length=0; downloads.length=0;providerCalls=0;uploadCalls=0;providerError=null;output={};uploaded=null;providerInput=null;
  tables={profiles:{id:"owner",active_career_profile_id:"profile"},career_profiles:{id:"profile",user_id:"owner"}};
  rpcResults={};
  client={
    auth:{getUser:async()=>({data:{user:{id:"owner"}},error:null})},
    storage:{from:()=>({download:async(path:string)=>{downloads.push(path);return {data:new Blob(["resume"]),error:null};}})},
    from:(table:string)=>{
      const filters: Record<string,unknown>={};
      const query: any={
        select:()=>query,eq:(k:string,v:unknown)=>{filters[k]=v;return query;},order:()=>query,limit:()=>query,
        maybeSingle:async()=>{
          let row=tables[table]??null;
          if(row && Object.entries(filters).some(([k,v])=>row[k]!==v)) row=null;
          return {data:row,error:null};
        },
        then:(resolve:any,reject:any)=>Promise.resolve({data:Array.isArray(tables[table])?tables[table]:[],error:null,count:0}).then(resolve,reject),
      };return query;
    },
    rpc:async()=>{throw new Error("User session must never execute privileged RPCs");},
    trustedRpc:async(name:string,args:any)=>{calls.push({name,args});const value=rpcResults[name];return typeof value==="function"?value(args):value??{data:null,error:null};},
  };
}
const request=(body:unknown,key="request-A")=>new Request("http://localhost/api/test",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)});
const context={career_profile_id:"profile",resume:null,resumeText:"My experience",jobDescription:"PM job",targetRole:"PM",targetLevel:"Senior"};
const claimed={outcome:"claimed",id:"op",token:"token",context,checkpoint:null,investigation_id:null,user_turn_id:null};
const result={analysisId:"analysis",planId:"plan",result:{positioning_summary:"Fit",signals:[],gaps:[],plan:{next_best_action:"Improve",tasks:[]}}};
const analyze = require("../../app/api/analyze/route.ts").POST;
const compare = require("../../app/api/compare/route.ts").POST;
const turns = require("../../app/api/gap-investigations/[id]/turns/route.ts").POST;
const kickoff = require("../../app/api/gap-investigations/route.ts").POST;
(Module as any)._load = originalLoad;

test("compare denies unowned path before quota, storage, upload, or generation",async()=>{
  reset();tables.resumes={id:"r",user_id:"someone-else",career_profile_id:"profile",file_path:"private/other.pdf"};
  const response=await compare(request({latestResume:{file_path:"private/other.pdf"},jobDescriptions:["PM"]}));
  assert.equal(response.status,404);assert.equal(calls.length,0);assert.equal(downloads.length,0);assert.equal(providerCalls,0);
});
test("compare uses owned metadata and isolates file from pasted text",async()=>{
  reset();tables.resumes={id:"r",user_id:"owner",career_profile_id:"profile",file_path:"owner/real.pdf",file_name:"real.pdf",mime_type:"application/pdf"};
  rpcResults.try_consume_rate_limit={data:[{outcome:"reserved",event_id:"event",quota_limit:5,used:1}],error:null};output={score:4};
  const response=await compare(request({latestResume:{id:"r",file_path:"other/forged.pdf",file_name:"forged.pdf"},resumeText:"stale",jobDescriptions:["PM"]}));
  assert.equal(response.status,200);assert.deepEqual(downloads,["owner/real.pdf"]);assert.equal((uploaded as any).file.name,"real.pdf");assert.equal(uploadCalls,1);assert.equal(providerCalls,1);
  assert.ok(!JSON.stringify(providerInput).includes("stale"));
  assert.equal(calls.at(-1)?.name,"complete_rate_limit");
});
test("compare rejects a resume from another career profile",async()=>{
  reset();tables.resumes={id:"r",user_id:"owner",career_profile_id:"other-profile",file_path:"owner/resume.pdf"};
  assert.equal((await compare(request({resume_id:"r",jobDescriptions:["PM"]}))).status,404);
  assert.equal(downloads.length,0);
});
test("compare validates JD array before quota and provider",async()=>{
  reset();assert.equal((await compare(request({resumeText:"text",jobDescriptions:"invalid"}))).status,400);assert.equal(calls.length,0);
});
test("analysis completed replay preserves data contract before profile/free-limit checks",async()=>{
  reset();client.from=()=>{throw new Error("Replay must not query new-work inputs");};
  rpcResults.lookup_career_operation={data:{outcome:"completed",result},error:null};
  const response=await analyze(request({resumeText:"text",jobDescription:"job"}));
  assert.equal(response.status,200);assert.deepEqual((await response.json()).data,result);assert.equal(providerCalls,0);
  assert.deepEqual(calls.map(c=>c.name),["lookup_career_operation"]);
});
test("analysis checkpoint retry calls production finalizer without OpenAI",async()=>{
  reset();rpcResults.lookup_career_operation={data:{outcome:"pending",context,checkpoint:result.result},error:null};
  rpcResults.claim_career_operation={data:{...claimed,checkpoint:result.result},error:null};
  rpcResults.finalize_career_analysis={data:result,error:null};
  const response=await analyze(request({resumeText:"text",jobDescription:"job"}));
  assert.equal(response.status,200);assert.deepEqual((await response.json()).data,result);assert.equal(providerCalls,0);
  assert.ok(calls.find(c=>c.name==="finalize_career_analysis")?.args.p_rows);assert.ok(!calls.some(c=>c.name==="complete_rate_limit"));
});
test("analysis generates then checkpoints before transactional finalization",async()=>{
  reset();rpcResults.claim_career_operation={data:claimed,error:null};rpcResults.finalize_career_analysis={data:result,error:null};output=result.result;
  const response=await analyze(request({resumeText:"text",jobDescription:"job"}));
  assert.equal(response.status,200);assert.equal(providerCalls,1);
  assert.deepEqual(calls.map(c=>c.name),["lookup_career_operation","claim_career_operation","checkpoint_career_operation","finalize_career_analysis"]);
});
test("analysis persistence failure releases lease without refund or regeneration",async()=>{
  reset();rpcResults.lookup_career_operation={data:{outcome:"pending",context,checkpoint:result.result},error:null};rpcResults.claim_career_operation={data:{...claimed,checkpoint:result.result},error:null};rpcResults.finalize_career_analysis={data:null,error:{message:"DB unavailable"}};
  assert.equal((await analyze(request({resumeText:"text",jobDescription:"job"}))).status,503);
  assert.equal(providerCalls,0);assert.equal(calls.at(-1)?.name,"release_career_operation");assert.equal(calls.at(-1)?.args.p_transient,false);
});
test("analysis idempotency conflict and quota denial never call provider",async()=>{
  reset();rpcResults.lookup_career_operation={data:{outcome:"conflict"},error:null};assert.equal((await analyze(request({resumeText:"text",jobDescription:"job"}))).status,409);
  reset();rpcResults.claim_career_operation={data:{outcome:"rate_limited",quota:{quota_limit:5,used:5,retry_after_seconds:30}},error:null};
  const response=await analyze(request({resumeText:"text",jobDescription:"job"}));assert.equal(response.status,429);assert.equal(response.headers.get("Retry-After"),"30");assert.equal(providerCalls,0);
});
test("turn handler claims before loading transcript; duplicate does no writes",async()=>{
  reset();client.from=()=>{throw new Error("Duplicate must not read/write transcript");};rpcResults.claim_career_operation={data:{outcome:"in_progress"},error:null};
  const response=await turns(request({content:"answer",question_id:"question"}),{params:Promise.resolve({id:"inv"})});
  assert.equal(response.status,409);assert.deepEqual(calls.map(c=>c.name),["claim_career_operation"]);assert.equal(providerCalls,0);
});
test("turn completed retry returns bundle even when investigation is concluded",async()=>{
  reset();tables.gap_investigations={id:"inv",user_id:"owner",status:"concluded"};tables.gap_investigation_turns=[];tables.gap_investigation_evidence=[];
  rpcResults.claim_career_operation={data:{outcome:"completed",result:{investigation_id:"inv"}},error:null};
  const response=await turns(request({content:"answer"}),{params:Promise.resolve({id:"inv"})});
  assert.equal(response.status,200);assert.equal((await response.json()).data.investigation.status,"concluded");assert.equal(providerCalls,0);
});
test("kickoff saved-output retry does not upload or generate",async()=>{
  reset();rpcResults.lookup_career_operation={data:{outcome:"pending",context:{...context,snapshot:{}},checkpoint:{agent:{}}},error:null};rpcResults.claim_career_operation={data:{...claimed,checkpoint:{agent:{}}},error:null};rpcResults.finalize_career_gap={data:{investigation_id:"inv"},error:null};
  client.from=()=>{throw new Error("Recovery uses frozen operation context");};
  const response=await kickoff(request({gap_id:"gap"}));assert.equal(response.status,200);assert.equal(uploadCalls,0);assert.equal(providerCalls,0);
});

test("analysis provider timeout requests refund without checkpointing",async()=>{
  reset();rpcResults.claim_career_operation={data:claimed,error:null};
  providerError=Object.assign(Object.create(realOpenAI.APIConnectionTimeoutError.prototype),{message:"test provider timeout"});
  assert.equal((await analyze(request({resumeText:"text",jobDescription:"job"}))).status,500);
  assert.equal(calls.at(-1)?.name,"release_career_operation");assert.equal(calls.at(-1)?.args.p_transient,true);
  assert.ok(!calls.some(c=>c.name==="checkpoint_career_operation"));
});
test("blank idempotency key rejected before any database work",async()=>{
  reset();assert.equal((await analyze(request({resumeText:"text",jobDescription:"job"}," "))).status,400);assert.equal(calls.length,0);
});
test("operation infrastructure fails closed instead of generating without accounting",async()=>{
  reset();rpcResults.lookup_career_operation={error:{message:"RPC missing",code:"PGRST202"},data:null};
  assert.equal((await analyze(request({resumeText:"text",jobDescription:"job"}))).status,503);assert.equal(providerCalls,0);
});
test("saved-result-unavailable response cannot fall through into OpenAI",async()=>{
  reset();rpcResults.lookup_career_operation={data:{outcome:"unavailable"},error:null};
  assert.equal((await analyze(request({resumeText:"text",jobDescription:"job"}))).status,409);assert.equal(providerCalls,0);
});
test("turn production path preserves decision-sufficiency gate before checkpoint",async()=>{
  reset();
  tables.gap_investigations={id:"inv",user_id:"owner",status:"active",context_snapshot:{gap:{gap_title:"Scope",gap_description:"Depth"},target:{role:"PM",level:"Senior"},analysis:{related_signals:[]},resume:{}},openai_resume_file_id:null};
  tables.gap_investigation_turns=[{id:"question",role:"assistant",turn_index:0,content:"Question",structured:null},{id:"answer",role:"user",turn_index:1,content:"Answer",structured:null}];tables.gap_investigation_evidence=[];
  rpcResults.claim_career_operation={data:{...claimed,investigation_id:"inv",user_turn_id:"answer"},error:null};rpcResults.finalize_career_gap={data:{investigation_id:"inv"},error:null};
  output={action:"ask_question",next_question:"More?",next_question_target_dimension:"other",candidate_evidence:[],conclusion:{classification:"partial_evidence",summary:"",remaining_uncertainty:"",residual_gap:""},decision_state:{would_next_question_change_conclusion:false,material_uncertainty:"Resume needs clarity",current_conclusion:{underlying_capability:"demonstrated",resume_evidence:"partial",target_role_fit:"meets"}}};
  const response=await turns(request({content:"Answer",question_id:"question"}),{params:Promise.resolve({id:"inv"})});
  assert.equal(response.status,200);assert.equal(providerCalls,1);
  assert.equal(calls.find(c=>c.name==="checkpoint_career_operation")?.args.p_output.agent.action,"stop_and_conclude");
  assert.deepEqual(calls.map(c=>c.name),["claim_career_operation","checkpoint_career_operation","finalize_career_gap"]);
});

test("browser retry identity survives retries and clears after success without storing inputs",async()=>{
  const {retryKey}=require("../../lib/ai-operations/client.ts");
  const saved=new Map<string,string>();const previous=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage");
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value),removeItem:(key:string)=>saved.delete(key)}});
  try {
    const first=await retryKey("test",{resumeText:"Sensitive resume"});
    assert.equal((await retryKey("test",{resumeText:"Sensitive resume"})).key,first.key);
    assert.ok(!JSON.stringify([...saved]).includes("Sensitive resume"));
    first.clear();assert.notEqual((await retryKey("test",{resumeText:"Sensitive resume"})).key,first.key);
    assert.notEqual((await retryKey("turn",{question_id:"q1",content:"Same answer"})).key,(await retryKey("turn",{question_id:"q2",content:"Same answer"})).key);
  } finally { if(previous) Object.defineProperty(globalThis,"sessionStorage",previous);else Reflect.deleteProperty(globalThis,"sessionStorage"); }
});
test("browser storage-disabled fallback retains the key until success",async()=>{
  const {retryKey}=require("../../lib/ai-operations/client.ts");const previous=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage");
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,get:()=>{throw new Error("Storage blocked");}});
  try {
    const first=await retryKey("storage-disabled","payload");assert.equal((await retryKey("storage-disabled","payload")).key,first.key);
    first.clear();const next=await retryKey("storage-disabled","payload");assert.notEqual(next.key,first.key);next.clear();
  } finally { if(previous) Object.defineProperty(globalThis,"sessionStorage",previous);else Reflect.deleteProperty(globalThis,"sessionStorage"); }
});

 test("server helper overwrites supplied identity with the verified session identity",async()=>{
  reset();
  const {operationRpc}=require("../../lib/ai-operations/server.ts");
  await operationRpc("owner","lookup_career_operation",{p_user_id:"attacker",p_kind:"analyze",p_key:"a",p_hash:"h"});
  assert.equal(calls[0].args.p_user_id,"owner");
});
test("unauthenticated requests cannot reach privileged helper or AI",async()=>{
  reset();client.auth.getUser=async()=>({data:{user:null},error:null});
  for(const handler of [analyze,compare,kickoff]) assert.equal((await handler(request({userId:"owner",p_user_id:"owner"}))).status,401);
  assert.equal((await turns(request({content:"Fake",userId:"owner"}),{params:Promise.resolve({id:"inv"})})).status,401);
  assert.equal(calls.length,0);assert.equal(providerCalls,0);
});
test("request body cannot override authenticated identity for privileged calls",async()=>{
  reset();rpcResults.claim_career_operation={data:claimed,error:null};rpcResults.finalize_career_analysis={data:result,error:null};output=result.result;
  assert.equal((await analyze(request({resumeText:"My experience",jobDescription:"PM job",userId:"victim",p_user_id:"victim"}))).status,200);
  assert.ok(calls.length>0);assert.ok(calls.every(c=>c.args.p_user_id==="owner"));
});

test("retry key survives a fresh module load with the same tab storage",async()=>{
  const modulePath=require.resolve("../../lib/ai-operations/client.ts");
  const previous=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage"),saved=new Map<string,string>();
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>saved.set(k,v),removeItem:(k:string)=>saved.delete(k)}});
  try {
    const payload={content:"Answer",question_id:"question"};
    const first=await require(modulePath).retryKey("reload",payload);
    delete require.cache[modulePath];
    assert.equal((await require(modulePath).retryKey("reload",payload)).key,first.key);
    first.clear();
  } finally { if(previous) Object.defineProperty(globalThis,"sessionStorage",previous);else Reflect.deleteProperty(globalThis,"sessionStorage"); }
});
test("investigation reload renders the saved pending answer in its input",()=>{
  const React=require("react"),{renderToStaticMarkup}=require("react-dom/server");
  const Component=require("../../app/dashboard/gap-investigations/[id]/investigation-client.tsx").default;
  const html=renderToStaticMarkup(React.createElement(Component,{initialBundle:{investigation:{id:"inv",status:"active"},turns:[{id:"q",role:"assistant",content:"Question"},{id:"u",role:"user",content:"Saved pending answer"}],evidence:[]}}));
  assert.match(html,/<textarea[^>]*>Saved pending answer<\/textarea>/);
});
