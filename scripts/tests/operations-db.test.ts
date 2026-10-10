/* eslint-disable @typescript-eslint/no-explicit-any -- Structural test doubles and CJS network-boundary injection; production logic is imported unchanged. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

// Hard-coded disposable local target. Never reads .env.local or a project DB URL.
const database = `careermind_remediation_test_${process.pid}`;
const port = process.env.CAREERMIND_TEST_PGPORT ?? "55439";
assert.match(port, /^\d+$/);
const env: NodeJS.ProcessEnv = { ...process.env, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: database, PGUSER: process.env.USER, PGPASSWORD: "", PGSERVICEFILE: "/dev/null", PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "3" };
delete env.PGSERVICE;
delete env.PGOPTIONS;
const argv = ["-X", "-v", "ON_ERROR_STOP=1", "-Atq"];
const sql = (statement: string, db = database) => execFileSync("psql", argv, { env: { ...env, PGDATABASE: db }, input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const quote = (value: unknown) => `'${String(typeof value === "object" ? JSON.stringify(value) : value).replaceAll("'", "''")}'`;
const uid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const profile = "33333333-3333-4333-8333-333333333333";
// Server RPCs receive identity explicitly; JWT subject is intentionally unrelated.
const server = (statement: string, user = uid) => `set request.jwt.claim.sub=${quote(other)}; set role service_role; ${statement.replace(/\b(lookup_career_operation|claim_career_operation|checkpoint_career_operation|release_career_operation|finalize_career_analysis|finalize_career_gap)\(/g, `$1(${quote(user)},`)}`;
const browser = (statement: string, role = "authenticated") => sql(`set request.jwt.claim.sub=${quote(uid)}; set role ${role}; ${statement}`);
const query = (statement: string, user = uid) => sql(server(statement,user));
const json = (statement: string) => JSON.parse(query(statement));
let passed = 0;
function test(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
function rejected(statement: string) { assert.throws(() => query(statement)); }
const claim = (kind: string, key: string | null, hash: string, context: unknown, extra = "null,null,null") => json(`select claim_career_operation(${quote(kind)},${key ? quote(key) : "null"},${quote(hash)},${quote(context)}::jsonb,${extra});`);
const checkpoint = (op: any, output: unknown) => query(`select checkpoint_career_operation('${op.id}','${op.token}',${quote(output)}::jsonb);`);
const release = (op: any, transient = false) => query(`select release_career_operation('${op.id}','${op.token}',${transient});`);
const finalizeGap = (op: any) => json(`select finalize_career_gap('${op.id}','${op.token}');`);
const rows = { signals: [{ signal_name:"Ownership", score:4, rationale:"Direct", evidence:["Owned roadmap"], risk_level:"low" }], gaps: [], tasks: [{title:"Improve",description:"A task",priority:1,task_type:"resume"}] };
const analysisOutput = { positioning_summary:"Fit", signals:rows.signals, gaps:[], plan:{ next_best_action:"Improve", tasks:rows.tasks } };
const context = { career_profile_id:profile, resume:null, resumeText:"Pasted",jobDescription:"PM",targetRole:"PM",targetLevel:"Senior" };
const agent = { action:"ask_question",next_question:"What did you own?",candidate_evidence:[] };
async function concurrent(statement: string, n=10) {
  return Promise.all(Array.from({length:n},()=>new Promise<string>((resolve,reject)=>{
    const child=spawn("psql",argv,{env,stdio:["pipe","pipe","pipe"]});let out="",err="";
    child.stdout.on("data",b=>out+=b);child.stderr.on("data",b=>err+=b);
    child.on("error",reject);child.on("close",code=>code===0?resolve(out.trim()):reject(new Error(err)));
    child.stdin.end(server(statement));
  })));
}

async function main() {
  sql(`create database ${database};`,"postgres");
  try {
    sql(readFileSync("scripts/tests/base-schema.fixture.sql","utf8"));
    const migrations = ["20260823183756_career_profiles.sql","20260823203857_signal_gap_codes.sql","20260823205615_career_goal_description.sql","20260923000001_gap_investigations.sql","20261003000001_gap_investigation_dimensions.sql","20261010000001_rate_limits.sql","20261010000002_ai_operation_correctness.sql","20261010000003_trusted_ai_rpcs.sql"];
    for(const file of migrations) sql(readFileSync(`supabase/migrations/${file}`,"utf8"));
    test("all three remediation migrations apply and can be applied again",()=>{
      sql(readFileSync(`supabase/migrations/${migrations[5]}`,"utf8"));
      sql(readFileSync(`supabase/migrations/${migrations[6]}`,"utf8"));
      sql(readFileSync(`supabase/migrations/${migrations[7]}`,"utf8"));
    });
    sql(`insert into auth.users values('${uid}'),('${other}');insert into profiles(id) values('${uid}'),('${other}');insert into career_profiles(id,user_id,name) values('${profile}','${uid}','Search');`);
    test("anonymous RPC denied; operation table inaccessible; raw quota RPC denied",()=>{
      assert.throws(()=>sql("set role anon; select claim_career_operation('analyze','a','a','{}');"));
      assert.throws(()=>browser("select * from career_ai_operations;"));
      assert.throws(()=>browser(`select try_consume_rate_limit('${uid}','analyze',5);`));
    });
    const rpcSignatures = [
      "lookup_career_operation(uuid,text,text,text)",
      "claim_career_operation(uuid,text,text,text,jsonb,uuid,text,uuid)",
      "checkpoint_career_operation(uuid,uuid,uuid,jsonb)",
      "release_career_operation(uuid,uuid,uuid,boolean)",
      "finalize_career_analysis(uuid,uuid,uuid,jsonb)",
      "finalize_career_gap(uuid,uuid,uuid)",
      "try_consume_rate_limit(uuid,text,integer,text)",
      "complete_rate_limit(uuid,uuid,text)", "fail_rate_limit(uuid,uuid)", "refund_rate_limit(uuid,uuid)",
    ];
    test("all ten RPCs have service-only ACLs, definer security, and fixed search paths",()=>{
      for (const signature of rpcSignatures) {
        assert.equal(sql(`select has_function_privilege('anon','public.${signature}','execute'),has_function_privilege('authenticated','public.${signature}','execute'),has_function_privilege('service_role','public.${signature}','execute');`),"f|f|t");
        assert.equal(sql(`select prosecdef and proconfig @> array['search_path=pg_catalog, public, pg_temp'] from pg_proc where oid='public.${signature}'::regprocedure;`),"t");
      }
      assert.equal(sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname = any(array['lookup_career_operation','claim_career_operation','checkpoint_career_operation','release_career_operation','finalize_career_analysis','finalize_career_gap','try_consume_rate_limit','complete_rate_limit','fail_rate_limit','refund_rate_limit']);"),"10");
    });
    test("anonymous and authenticated callers cannot execute any RPC, even with victim identity/token",()=>{
      const calls = [
        `lookup_career_operation('${uid}','analyze','a','h')`,
        `claim_career_operation('${uid}','analyze','a','h','{}',null,null,null)`,
        `checkpoint_career_operation('${uid}','${other}','${other}','{}')`,
        `release_career_operation('${uid}','${other}','${other}',true)`,
        `finalize_career_analysis('${uid}','${other}','${other}','{}')`,
        `finalize_career_gap('${uid}','${other}','${other}')`,
        `try_consume_rate_limit('${uid}','analyze',5,'a')`,
        `complete_rate_limit('${other}','${uid}','a')`,
        `fail_rate_limit('${other}','${uid}')`, `refund_rate_limit('${other}','${uid}')`,
      ];
      for(const role of ["anon","authenticated"]) for(const call of calls) {
        assert.throws(()=>browser(`select ${call};`,role),/permission denied for function/);
      }
      assert.equal(sql("select count(*) from career_ai_operations;"),"0");
      assert.equal(sql("select count(*) from rate_limit_events;"),"0");
    });
    test("all ten role guards reject clients even after accidental EXECUTE grants",()=>{
      for (const signature of rpcSignatures) {
        sql(`grant execute on function ${signature} to authenticated;`);
        const args=signature.slice(signature.indexOf("(")+1,-1).split(",").map(type=>type==="uuid"?quote(uid):type==="text"?quote("probe"):type==="jsonb"?"'{}'::jsonb":type==="boolean"?"true":"5").join(",");
        try { assert.throws(()=>browser(`select ${signature.split("(")[0]}(${args});`),/Trusted server required/); }
        finally { sql(`revoke execute on function ${signature} from authenticated;`); }
      }
    });
    test("quota ledger cannot be mutated directly by anonymous or authenticated clients",()=>{
      for(const role of ["anon","authenticated"]) {
        assert.throws(()=>browser(`insert into rate_limit_events(user_id,bucket) values('${uid}','analyze');`,role),/permission denied/);
        assert.throws(()=>browser("update rate_limit_events set status='refunded';",role),/permission denied/);
        assert.throws(()=>browser("delete from rate_limit_events;",role),/permission denied/);
      }
    });
    test("migration revokes unexpected RPC overloads instead of leaving a client entry point",()=>{
      sql("create function refund_rate_limit(text) returns boolean language sql as $$ select true $$; grant execute on function refund_rate_limit(text) to authenticated;");
      try {
        sql(readFileSync("supabase/migrations/20261010000003_trusted_ai_rpcs.sql","utf8"));
        for(const role of ["anon","authenticated","service_role"]) assert.equal(sql(`select has_function_privilege('${role}','refund_rate_limit(text)','execute');`),"f");
        assert.throws(()=>browser("select refund_rate_limit('bypass');"),/permission denied/);
      } finally { sql("drop function refund_rate_limit(text);"); }
    });
    test("session identity rejects unowned profiles and resumes",()=>{
      assert.throws(()=>sql(server(`select claim_career_operation('analyze','cross','h',${quote(context)});`,other)));
      rejected(`select claim_career_operation('analyze','cross-resume','h',${quote({...context,resume:{id:other}})});`);
    });
    test("legacy retry keys are rejected without silently repeating paid work",()=>{
      sql(`insert into rate_limit_events(user_id,bucket,idempotency_key,status,created_at) values('${uid}','analyze','old-key','completed',now()-interval '2 hours');`);
      assert.equal(json(`select lookup_career_operation('analyze','old-key','hash');`).outcome,"legacy_key");
      assert.equal(claim("analyze","old-key","hash",context).outcome,"legacy_key");
      assert.equal(sql("select count(*) from career_ai_operations;"),"0");
      sql("delete from rate_limit_events where idempotency_key='old-key';");
    });
    let op=claim("analyze","analysis-A","hash-A",context);
    test("duplicate running operation blocked; changed input conflicts",()=>{
      assert.equal(op.outcome,"claimed");
      assert.equal(claim("analyze","analysis-A","hash-A",context).outcome,"in_progress");
      assert.equal(claim("analyze","analysis-A","changed",context).outcome,"conflict");
    });
    test("trusted server still enforces operation ownership for known tokens",()=>{
      assert.throws(()=>sql(server(`select checkpoint_career_operation('${op.id}','${op.token}','{}');`,other)));
      assert.throws(()=>sql(server(`select finalize_career_analysis('${op.id}','${op.token}','{}');`,other)));
      sql(server(`select release_career_operation('${op.id}','${op.token}',true);`,other));
      assert.equal(sql("select status from rate_limit_events;"),"in_progress");
    });
    checkpoint(op,analysisOutput);
    test("trusted quota mutations cannot refund, fail or complete another user's reservation",()=>{
      const event=sql("select id from rate_limit_events;");
      for(const call of [`refund_rate_limit('${event}','${other}')`,`fail_rate_limit('${event}','${other}')`,`complete_rate_limit('${event}','${other}','fake')`]) {
        assert.equal(sql(`set role service_role; select ${call};`),"f");
      }
      assert.equal(sql("select status from rate_limit_events;"),"in_progress");
    });
    test("trusted operation claims reject missing identity instead of using a JWT subject",()=>{
      assert.throws(()=>sql(`set request.jwt.claim.sub='${uid}';set role service_role;select claim_career_operation(null,'analyze','missing','h','{}');`),/Unauthorized/);
    });
    test("invalid required task rolls back every analysis write and completion",()=>{
      rejected(`select finalize_career_analysis('${op.id}','${op.token}',${quote({...rows,tasks:[{title:"Bad",priority:0}]})});`);
      assert.equal(sql("select count(*) from analyses;"),"0");
      assert.equal(sql("select status from career_ai_operations;"),"running");
      assert.equal(sql("select status from rate_limit_events;"),"in_progress");
    });
    release(op);
    let retry=claim("analyze","analysis-A","hash-A",context);
    test("saved-output retry reuses quota reservation and rejects stale worker",()=>{
      assert.ok(retry.checkpoint);
      assert.equal(sql("select count(*) from rate_limit_events;"),"1");
      rejected(`select checkpoint_career_operation('${op.id}','${op.token}','{}');`);
      release(op,true);
      assert.equal(sql("select status from rate_limit_events;"),"in_progress");
    });
    const result=json(`select finalize_career_analysis('${retry.id}','${retry.token}',${quote(rows)});`);
    test("full analysis and quota complete atomically; replay preserves contract",()=>{
      assert.ok(result.analysisId);assert.ok(result.planId);assert.deepEqual(result.result,analysisOutput);
      assert.deepEqual(claim("analyze","analysis-A","hash-A",context).result,result);
      assert.equal(sql("select count(*) from plan_tasks;"),"1");
      assert.equal(sql("select status from rate_limit_events;"),"completed");
      assert.equal(sql("select checkpoint is null and context='{}'::jsonb from career_ai_operations;"),"t");
      assert.equal(query(`select lookup_career_operation('analyze','analysis-A','hash-A');`,other),"");
    });
    const gap=sql(`insert into gaps(analysis_id,user_id,gap_title,priority) values('${result.analysisId}','${uid}','Scope',1) returning id;`);
    const kickoffContext={...context,seed_gap_id:gap,seed_analysis_id:result.analysisId,snapshot:{gap:{gap_title:"Scope"}},gap_code:null};
    const kickoff=claim("gap_kickoff","kickoff-A","kick-h",kickoffContext);
    checkpoint(kickoff,{agent,file_id:null});const inv=finalizeGap(kickoff).investigation_id;
    const question=sql(`select id from gap_investigation_turns where investigation_id='${inv}';`);
    test("kickoff creates one complete investigation and replays it",()=>{
      assert.equal(claim("gap_kickoff","kickoff-A","kick-h",kickoffContext).result.investigation_id,inv);
      assert.equal(sql("select count(*) from gap_investigations;"),"1");
    });
    const turnArgs=`'${inv}','I owned it','${question}'`;
    const claims=await concurrent(`select claim_career_operation('gap_turn','turn-A','turn-h','{}',${turnArgs});`);
    const replies=claims.map(s=>JSON.parse(s));op=replies.find(o=>o.outcome==="claimed");
    test("10 simultaneous turn retries produce one worker and one answer",()=>{
      assert.equal(replies.filter(o=>o.outcome==="claimed").length,1);
      assert.equal(replies.filter(o=>o.outcome==="in_progress").length,9);
      assert.equal(sql(`select count(*) from gap_investigation_turns where investigation_id='${inv}' and role='user';`),"1");
    });
    test("different pending answer conflicts without changing transcript",()=>{
      assert.equal(claim("gap_turn","different","different",{},`'${inv}','Other answer','${question}'`).outcome,"conflict");
    });
    test("transient failure refunds attempt; retry preserves answer and reserves new AI work",()=>{
      release(op,true);const before=sql("select count(*) from rate_limit_events;");
      retry=claim("gap_turn","turn-A","turn-h",{},turnArgs);
      assert.equal(Number(sql("select count(*) from rate_limit_events;")),Number(before)+1);
      assert.equal(sql(`select status from rate_limit_events where id=(select event_id from career_ai_operations where id='${op.id}');`),"in_progress");
      assert.equal(sql(`select count(*) from gap_investigation_turns where investigation_id='${inv}' and role='user';`),"1");
    });
    checkpoint(retry,{agent:{...agent,candidate_evidence:[{source_type:"user",claim:"Owned roadmap",resume_excerpt:"",origin_user_turn_index:1,dimensions:{ownership:"Owned"},evidence_level:"direct"}]}});
    test("evidence failure rolls back assistant response and investigation update",()=>{
      sql(`update career_ai_operations set checkpoint=jsonb_set(checkpoint,'{agent,candidate_evidence,0,source_type}','"invalid"') where id='${retry.id}';`);
      rejected(`select finalize_career_gap('${retry.id}','${retry.token}');`);
      assert.equal(sql(`select count(*) from gap_investigation_turns where investigation_id='${inv}';`),"2");
      assert.equal(sql(`select turn_count from gap_investigations where id='${inv}';`),"0");
      sql(`update career_ai_operations set checkpoint=jsonb_set(checkpoint,'{agent,candidate_evidence,0,source_type}','"user"') where id='${retry.id}';`);
    });
    finalizeGap(retry);
    test("assistant, evidence provenance, turn count, and completion persist together",()=>{
      assert.equal(sql(`select count(*) from gap_investigation_turns where investigation_id='${inv}';`),"3");
      assert.equal(sql(`select turn_count from gap_investigations where id='${inv}';`),"1");
      assert.equal(sql(`select origin_turn_id=(select user_turn_id from career_ai_operations where id='${op.id}') from gap_investigation_evidence;`),"t");
      assert.equal(claim("gap_turn","turn-A","turn-h",{},turnArgs).outcome,"completed");
      assert.equal(claim("gap_turn","fresh-key","turn-h",{},turnArgs).outcome,"completed");
    });
    const nextQ=sql(`select id from gap_investigation_turns where investigation_id='${inv}' order by turn_index desc limit 1;`);
    op=claim("gap_turn","turn-B","turn-B",{},`'${inv}','Another answer','${nextQ}'`);
    sql(`update career_ai_operations set lease_until=now()-interval '1 minute' where id='${op.id}';`);
    const before=Number(sql("select count(*) from rate_limit_events;"));
    retry=claim("gap_turn","turn-B","turn-B",{},`'${inv}','Another answer','${nextQ}'`);
    test("expired attempt requires fresh quota and cannot commit or refund its successor",()=>{
      assert.equal(Number(sql("select count(*) from rate_limit_events;")),before+1);
      rejected(`select checkpoint_career_operation('${op.id}','${op.token}','{}');`);
      release(op,true);
      assert.equal(sql(`select status from rate_limit_events where id=(select event_id from career_ai_operations where id='${op.id}');`),"in_progress");
    });
    checkpoint(retry,{agent:{...agent,action:"stop_and_conclude",conclusion:{classification:"evidence_gap",summary:"Done",underlying_capability:"demonstrated",resume_evidence:"partial",target_role_fit:"meets"}}});finalizeGap(retry);
    test("concluded exchange replays before active-state validation",()=>{
      assert.equal(claim("gap_turn","turn-B","turn-B",{},`'${inv}','Another answer','${nextQ}'`).outcome,"completed");
    });
    test("unique index prevents duplicate transcript positions",()=>{
      assert.throws(()=>sql(`insert into gap_investigation_turns(investigation_id,user_id,role,content,turn_index) values('${inv}','${uid}','user','duplicate',0);`));
    });
    test("browser transcript mutations cannot bypass serialization",()=>{
      for(const role of ["anon","authenticated"]) {
        assert.throws(()=>browser(`insert into gap_investigation_turns(investigation_id,user_id,role,content,turn_index) values('${inv}','${uid}','user','bypass',99);`,role),/permission denied/);
        for(const statement of ["update gap_investigation_turns set role='assistant';","delete from gap_investigation_turns;","truncate gap_investigation_turns;"]) assert.throws(()=>browser(statement,role),/permission denied/);
      }
    });
    test("same key reused for a different question is a conflict",()=>{
      assert.equal(claim("gap_turn","turn-A","turn-h",{},`'${inv}','I owned it','${nextQ}'`).outcome,"conflict");
    });
    const legacyInv=sql(`insert into gap_investigations(user_id,career_profile_id,status) values('${uid}','${profile}','active') returning id;`);
    sql(`insert into gap_investigation_turns(investigation_id,user_id,role,content,turn_index) values('${legacyInv}','${uid}','assistant','Legacy question',0),('${legacyInv}','${uid}','user','Legacy answer',1);`);
    const legacy=claim("gap_turn",null,"legacy",{},`'${legacyInv}','Legacy answer',null`);
    test("pre-migration pending answer is adopted without duplicate insertion",()=>{
      assert.equal(legacy.outcome,"claimed");
      assert.equal(sql(`select count(*) from gap_investigation_turns where investigation_id='${legacyInv}' and role='user';`),"1");
    });
    test("rollback refuses to discard a pending answer or output",()=>{
      assert.throws(()=>sql(readFileSync("supabase/rollback/20261010000002_ai_operation_correctness.sql","utf8")));
      assert.equal(sql(`select count(*) from career_ai_operations where id='${legacy.id}';`),"1");
    });
    checkpoint(legacy,{agent});finalizeGap(legacy);
    // Exercise JSON array conversion against both common legacy evidence types.
    sql("alter table signal_assessments alter column evidence type text[] using array[evidence::text];");
    const typed=claim("analyze","typed-evidence","typed-evidence",context);checkpoint(typed,analysisOutput);
    json(`select finalize_career_analysis('${typed.id}','${typed.token}',${quote(rows)});`);
    test("analysis transaction accepts an existing text[] evidence column",()=>{
      assert.equal(sql("select evidence[1] from signal_assessments order by id limit 1;") !== "",true);
      assert.equal(sql(`select evidence[1] from signal_assessments where analysis_id=(select (result->>'analysisId')::uuid from career_ai_operations where id='${typed.id}');`),"Owned roadmap");
    });
    const deniedInv=sql(`insert into gap_investigations(user_id,career_profile_id,status) values('${uid}','${profile}','active') returning id;`);
    const deniedQ=sql(`insert into gap_investigation_turns(investigation_id,user_id,role,content,turn_index) values('${deniedInv}','${uid}','assistant','Question',0) returning id;`);
    sql(`insert into rate_limit_events(user_id,bucket) select '${uid}','gap_turn' from generate_series(1,greatest(0,10-(select count(*)::int from rate_limit_events where user_id='${uid}' and bucket='gap_turn' and status<>'refunded')));`);
    test("quota denial preserves one pending answer across repeated retries",()=>{
      assert.equal(claim("gap_turn","denied","denied",{},`'${deniedInv}','Saved answer','${deniedQ}'`).outcome,"rate_limited");
      assert.equal(claim("gap_turn","denied","denied",{},`'${deniedInv}','Saved answer','${deniedQ}'`).outcome,"rate_limited");
      assert.equal(sql(`select count(*) from gap_investigation_turns where investigation_id='${deniedInv}' and role='user';`),"1");
    });
    const eventToRefund=sql(`select id from rate_limit_events where user_id='${uid}' and bucket='gap_turn' and idempotency_key is null limit 1;`);
    sql(`set role service_role; select refund_rate_limit('${eventToRefund}','${uid}');`);
    const resumed=claim("gap_turn","denied","denied",{},`'${deniedInv}','Saved answer','${deniedQ}'`);
    checkpoint(resumed,{agent});finalizeGap(resumed);
    test("pending answer resumes once quota becomes available",()=>{
      assert.equal(sql(`select count(*) from gap_investigation_turns where investigation_id='${deniedInv}';`),"3");
    });
    // Actual quota boundary, in separate connections (not a sequential DO loop).
    sql(`insert into rate_limit_events(user_id,bucket) select '${other}','analyze' from generate_series(1,4);`);
    const boundary=await concurrent(`reset role; set role service_role; select row_to_json(r) from try_consume_rate_limit('${other}','analyze',5) r;`);
    test("10 simultaneous quota requests at 4/5 allow exactly one",()=>{
      assert.equal(boundary.map(s=>JSON.parse(s)).filter(r=>r.outcome==="reserved").length,1);
    });
    test("rolling window excludes expired reservations",()=>{
      sql(`update rate_limit_events set created_at=now()-interval '61 minutes' where user_id='${other}';`);
      const reserved=JSON.parse(sql(`set role service_role; select row_to_json(r) from try_consume_rate_limit('${other}','analyze',5) r;`));
      assert.equal(reserved.outcome,"reserved");assert.equal(reserved.used,1);
    });
    test("duplicate legacy data aborts migration without deleting or renumbering",()=>{
      sql("drop index gap_turn_position_unique;");
      sql(`insert into gap_investigation_turns(investigation_id,user_id,role,content,turn_index) values('${inv}','${uid}','user','legacy duplicate',0);`);
      assert.throws(()=>sql(readFileSync("supabase/migrations/20261010000002_ai_operation_correctness.sql","utf8")));
      assert.equal(sql(`select count(*) from gap_investigation_turns where investigation_id='${inv}' and turn_index=0;`),"2");
      sql(`delete from gap_investigation_turns where content='legacy duplicate';`);
      sql(readFileSync("supabase/migrations/20261010000002_ai_operation_correctness.sql","utf8"));
      sql(readFileSync("supabase/migrations/20261010000003_trusted_ai_rpcs.sql","utf8"));
    });
    test("completed analysis with deleted artifacts cannot fall through into generation",()=>{
      sql(`delete from plan_tasks where plan_id='${result.planId}';delete from plans where id='${result.planId}';`);
      assert.equal(json(`select lookup_career_operation('analyze','analysis-A','hash-A');`).outcome,"unavailable");
      assert.equal(claim("analyze","analysis-A","hash-A",context).outcome,"unavailable");
    });
    test("free-analysis cap blocks new AI attempts but allows completed replay",()=>{
      sql(`insert into analyses(user_id,raw_json,career_profile_id) select '${uid}','{"test_free_cap_seed":true}','${profile}' from generate_series(1,100-(select count(*)::int from analyses where user_id='${uid}'));`);
      const events=sql("select count(*) from rate_limit_events;");
      assert.equal(claim("analyze","free-cap","free-cap",context).outcome,"free_limited");
      assert.equal(sql("select count(*) from rate_limit_events;"),events);
      assert.equal(claim("analyze","typed-evidence","typed-evidence",context).outcome,"completed");
      sql(`delete from analyses where raw_json @> '{"test_free_cap_seed":true}';`);
      const allowed=claim("analyze","free-cap","free-cap",context);checkpoint(allowed,analysisOutput);
      json(`select finalize_career_analysis('${allowed.id}','${allowed.token}',${quote(rows)});`);
    });
    test("privileged claim replaces forged resume metadata with the owned row",()=>{
      const resume=sql(`insert into resumes(user_id,career_profile_id,file_path,file_name,mime_type) values('${uid}','${profile}','owner/real.pdf','real.pdf','application/pdf') returning id;`);
      const owned=claim("analyze","canonical-resume","canonical-resume",{...context,resume:{id:resume,file_path:"other/forged.pdf",file_name:"forged.pdf"}});
      assert.equal(owned.context.resume.file_path,"owner/real.pdf");assert.equal(owned.context.resume.file_name,"real.pdf");
      checkpoint(owned,analysisOutput);json(`select finalize_career_analysis('${owned.id}','${owned.token}',${quote(rows)});`);
    });
    test("quota-denied new analyses do not accumulate frozen payloads",()=>{
      sql(`insert into rate_limit_events(user_id,bucket) select '${uid}','analyze' from generate_series(1,greatest(0,5-(select count(*)::int from rate_limit_events where user_id='${uid}' and bucket='analyze' and status<>'refunded' and created_at>now()-interval '60 minutes')));`);
      const before=sql("select count(*) from career_ai_operations;");
      assert.equal(claim("analyze","denied-analysis","denied-analysis",context).outcome,"rate_limited");
      assert.equal(sql("select count(*) from career_ai_operations;"),before);
    });
    test("read-only preflight script executes against the fixture",()=>{
      sql(readFileSync("supabase/validation/phase2a-preflight.sql","utf8"));
    });
    test("rollback after draining operations preserves domain data; migration reapplies",()=>{
      const counts=sql("select (select count(*) from analyses),(select count(*) from gap_investigation_turns),(select count(*) from gap_investigation_evidence);");
      sql(readFileSync("supabase/rollback/20261010000002_ai_operation_correctness.sql","utf8"));
      assert.equal(sql("select (select count(*) from analyses),(select count(*) from gap_investigation_turns),(select count(*) from gap_investigation_evidence);"),counts);
      sql(readFileSync("supabase/migrations/20261010000002_ai_operation_correctness.sql","utf8"));
      sql(readFileSync("supabase/migrations/20261010000003_trusted_ai_rpcs.sql","utf8"));
    });
    console.log(`\n${passed} database checks passed (PostgreSQL fixture; no OpenAI calls).`);
  } finally {
    sql(`drop database ${database} with (force);`,"postgres");
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
