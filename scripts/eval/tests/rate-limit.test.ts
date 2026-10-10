/* eslint-disable @typescript-eslint/no-explicit-any -- Structural test doubles and CJS network-boundary injection; production logic is imported unchanged. */
// Exercise the production classifier, orchestrator AND RPC wrappers. Only
// the Supabase network client is replaced; no copied business logic or secrets.
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import OpenAI from "openai";
import { classifyOpenAIError, isTransient } from "../../../lib/rate-limit/openai-errors";

const require = createRequire(import.meta.url);
let reservation: any;
let rpcFailure = false;
const calls: string[]=[];
const originalLoad=(Module as any)._load;
(Module as any)._load=function(specifier:string,...args:unknown[]) {
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(specifier)) return {supabaseAdmin:{rpc:async(name:string)=>{
    calls.push(name);
    return name==="try_consume_rate_limit" ? {data:[reservation],error:rpcFailure?{message:"local test outage"}:null} : {data:true,error:null};
  }}};
  return originalLoad.call(this,specifier,...args);
};
const {withReservation,rateLimitedResponse,rateLimitHeaders}=require("../../../lib/rate-limit/with-reservation.ts");
(Module as any)._load=originalLoad;
const sdkError=(type:any,status?:number)=>Object.assign(Object.create(type.prototype),{status});
const args={userId:"test-owner",bucket:"analyze"};
function reset(outcome="reserved") {
  calls.length=0;rpcFailure=false;
  reservation={outcome,event_id:"event",result_ref:"artifact",used:1,quota_limit:5,retry_after_seconds:30};
  delete process.env.CAREERMIND_RATE_LIMIT_FAIL_CLOSED;
}
for (const [type,status,expected] of [
  [OpenAI.APIConnectionTimeoutError,undefined,"transient_timeout"],
  [OpenAI.APIConnectionError,undefined,"transient_connection"],
  [OpenAI.RateLimitError,429,"transient_openai_rate_limit"],
  [OpenAI.InternalServerError,503,"transient_5xx"],
  [OpenAI.APIError,400,"permanent_4xx"],
  [OpenAI.APIError,500,"transient_5xx"],
] as const) test(`production classifier: ${expected}`,()=>assert.equal(classifyOpenAIError(sdkError(type,status)),expected));
test("plain application failure is permanent",()=>{assert.equal(classifyOpenAIError(new Error("parse")),"permanent_other");assert.equal(isTransient("permanent_other"),false);});
test("success invokes real completion wrapper and retains result",async()=>{
  reset();const result=await withReservation(args,async()=>({value:{ok:true},resultRef:"artifact"}));
  assert.equal(result.kind,"succeeded");assert.deepEqual(calls,["try_consume_rate_limit","complete_rate_limit"]);assert.equal(result.resultRefToStore,"artifact");
});
for(const [error,rpc] of [[sdkError(OpenAI.APIConnectionTimeoutError),"refund_rate_limit"],[sdkError(OpenAI.InternalServerError,503),"refund_rate_limit"],[sdkError(OpenAI.APIError,400),"fail_rate_limit"],[new Error("parse"),"fail_rate_limit"]] as const) test(`production orchestrator failure calls ${rpc}`,async()=>{
  reset();const result=await withReservation(args,async()=>{throw error;});assert.equal(result.kind,"openai_failed");assert.deepEqual(calls,["try_consume_rate_limit",rpc]);
});
for(const outcome of ["duplicate_in_progress","duplicate_completed","duplicate_failed","duplicate_refunded","rate_limited"]) test(`production ${outcome} prevents provider work`,async()=>{
  reset(outcome);let invoked=false;const result=await withReservation(args,async()=>{invoked=true;return {value:null};});assert.equal(result.kind,outcome);assert.equal(invoked,false);assert.equal(calls.length,1);
  if(outcome==="rate_limited") {const response=rateLimitedResponse(result);assert.equal(response.status,429);assert.equal(response.headers["Retry-After"],"30");}
});
test("legacy RPC fail-open has no synthetic completion RPC",async()=>{
  reset();rpcFailure=true;const result=await withReservation(args,async()=>({value:"ok"}));assert.equal(result.kind,"succeeded");assert.deepEqual(calls,["try_consume_rate_limit"]);
});
test("legacy RPC fail-closed prevents provider work",async()=>{
  reset();rpcFailure=true;process.env.CAREERMIND_RATE_LIMIT_FAIL_CLOSED="true";let invoked=false;const result=await withReservation(args,async()=>{invoked=true;return {value:null};});assert.equal(result.kind,"rate_limited");assert.equal(invoked,false);delete process.env.CAREERMIND_RATE_LIMIT_FAIL_CLOSED;
});
test("usage headers reflect remaining quota",()=>assert.deepEqual(rateLimitHeaders({used:4,limit:5}),{"X-RateLimit-Limit":"5","X-RateLimit-Remaining":"1"}));
