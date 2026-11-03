import assert from "node:assert/strict";
import { spawnSync, execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
const root = mkdtempSync(join(tmpdir(), "careermind-usage-")), data = join(root, "data");
const env = { ...process.env, PGHOST: root, PGPORT: "55473", PGUSER: "postgres", PGDATABASE: "postgres", PGPASSWORD: "" };
let started = false;
const args = ["-X", "-q", "-w", "-At", "--set", "ON_ERROR_STOP=1"];
function command(bin: string, a: string[], input?: string) {
    const r = spawnSync(bin, a, { env, input, encoding: "utf8", timeout: 30000 });
    if (r.error)
        throw r.error;
    return r;
}
function sql(query: string, ok = true) {
    const r = command("psql", args, query);
    if (ok)
        assert.equal(r.status, 0, r.stderr);
    else
        assert.notEqual(r.status, 0);
    return r.stdout.trim();
}
const quote = (v: unknown) => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
const h = (s: string) => createHash('sha256').update(s).digest('hex');
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", P = "33333333-3333-4333-8333-333333333333";
const R = '44444444-4444-4444-8444-444444444444';
function claimSQL(user = A, route = 'analysis', key: string = randomUUID(), units = 1, hash: string = key) { return `set role service_role; select public.ai_usage_claim('${user}','${h(key)}','${h(hash)}','${route}',${units});`; }
function claim(user = A, route = 'analysis', key: string = randomUUID(), units = 1, hash: string = key) { return JSON.parse(sql(claimSQL(user, route, key, units, hash))); }
type Op = {
    id: string;
    owner: string;
};
function step(o: Op, action: string, key: string, value: unknown = null, ok = true) { return sql(`set role service_role;select public.ai_usage_step('${o.id}','${o.owner}','${action}','${key}',${quote(value)});`, ok); }
function end(o: Op, status = 200, retry = false) { sql(`set role service_role;select public.ai_usage_end('${o.id}','${o.owner}',${quote({ status, body: { success: status === 200, data: 'saved-response' } })},${retry});`); }
function finish(o: Op) { step(o, 'begin', 'response:0'); step(o, 'response', 'response:0', { id: 'resp-fixture', model: 'gpt-4.1-2025-04-14', output_text: '{}', usage: { input_tokens: 20, output_tokens: 30 } }); end(o); sql(`update public.ai_usage_operations set created_at=clock_timestamp()-interval '2 minutes' where id='${o.id}'`); }
function reset() { sql('truncate public.ai_usage_operations,public.ai_usage_buckets; update public.ai_usage_settings set enabled=true,daily_budget_microusd=100000000;'); }
function persist(o: Op, kind: string, value: unknown, ok = true) { return sql(`set role service_role;select public.ai_usage_persist('${o.id}','${o.owner}','${kind}',${quote(value)});`, ok); }
before(() => {
    const init = command('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
    assert.equal(init.status, 0, init.stderr);
    const start = command('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-o', `-F -k ${root} -p 55473 -c listen_addresses=''`, '-w', 'start']);
    assert.equal(start.status, 0, start.stderr);
    started = true;
    sql(readFileSync('scripts/tests/ai-usage-fixture.sql', 'utf8'));
    sql(readFileSync('supabase/migrations/20261103000001_ai_usage_guard.sql', 'utf8'));
    console.log(`Disposable database: ${sql('show server_version')}`);
    sql(`insert into auth.users(id)values('${A}'),('${B}');insert into public.profiles(id)values('${A}'),('${B}');insert into public.career_profiles(id,user_id,name) values('${P}','${A}','Synthetic profile');insert into public.resumes(id,user_id,career_profile_id,file_path,file_name)values('${R}','${A}','${P}','${A}/123.txt','Synthetic.txt');`);
});
after(() => {
    if (started)
        command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    rmSync(root, { recursive: true, force: true });
});
test('migration commits disabled and omission of enabled cannot authorize generation', () => {
    // This must precede reset(): assert the actual migration's committed state.
    assert.equal(sql('select enabled from public.ai_usage_settings'), 'f');
    assert.equal(claim().code, 'AI_DISABLED');
    assert.equal(sql('select count(*) from public.ai_usage_operations'), '0');
    assert.equal(sql('select count(*) from public.ai_usage_buckets'), '0');
    assert.equal(sql('begin;delete from public.ai_usage_settings;insert into public.ai_usage_settings(id)values(true);select enabled from public.ai_usage_settings;rollback;'), 'f');
});
test('hosted fixture enforces enum checks, cross-table references and ownership RLS', () => {
    sql(`insert into public.analyses(user_id,analysis_type,raw_json)values('${A}','invalid','{}')`, false);
    sql(`insert into public.analyses(user_id,analysis_type,raw_json,resume_id)values('${A}','initial_onboarding','{}','${randomUUID()}')`, false);
    sql(`set role authenticated;set request.jwt.claim.sub='${B}';insert into public.career_profiles(user_id,name)values('${A}','Foreign synthetic')`, false);
    assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${B}';select count(*) from public.career_profiles where id='${P}'`), '0');
});
for (const role of ['anon', 'authenticated'])
    test(`${role} cannot call any accounting RPC or access usage tables`, () => {
        reset();
        for (const table of ['ai_usage_settings', 'ai_usage_operations', 'ai_usage_buckets'])
            sql(`set role ${role};select * from public.${table}`, false);
        for (const [name, params] of [['ai_usage_claim', `'${A}','${h('a')}','${h('a')}','analysis',1`], ['ai_usage_step', `'${A}','${B}','begin','x','null'`], ['ai_usage_end', `'${A}','${B}','{}',false`], ['ai_usage_persist', `'${A}','${B}','analysis','{}'`]])
            sql(`set role ${role}; select public.${name}(${params});`, false);
    });
for (const [route, limit] of [['analysis', 5], ['turn', 20], ['insights', 10]] as const)
    test(`${route} quota enforced atomically at ${limit}`, () => {
        reset();
        for (let i = 0; i < limit; i++) {
            const r = claim(A, route);
            assert.ok(r.operation);
            finish(r.operation);
        }
        assert.equal(claim(A, route).code, 'AI_DAILY_LIMIT');
    });
test('one concurrent request per user, but independent users proceed', () => { reset(); assert.ok(claim().operation); assert.equal(claim(A, 'turn').code, 'AI_IN_PROGRESS'); assert.ok(claim(B, 'analysis').operation); });
test('parallel independent database clients cannot double-claim a user', async () => { reset(); const results = await Promise.all(Array.from({ length: 12 }, () => new Promise<string>((resolve, reject) => execFile('psql', [...args, '-c', claimSQL()], { env }, (e, out) => e ? reject(e) : resolve(out.trim()))))); const json = results.map(r => JSON.parse(r)); assert.equal(json.filter(r => r.operation).length, 1); assert.equal(json.filter(r => r.code === 'AI_IN_PROGRESS').length, 11); assert.equal(Number(sql('select sum(used) from public.ai_usage_buckets')), 1); });
test('same idempotency key replays the exact response without quota or cost', () => { reset(); const key = randomUUID(), o = claim(A, 'analysis', key).operation; finish(o); const r = claim(A, 'analysis', key); assert.deepEqual(r.replay, { status: 200, body: { success: true, data: 'saved-response' } }); assert.equal(Number(sql("select used from public.ai_usage_buckets where category='analysis'")), 1); });
test('changed payload under an existing request key is rejected', () => { reset(); const key = randomUUID(); finish(claim(A, 'analysis', key).operation); assert.equal(claim(A, 'analysis', key, 1, 'changed').code, 'AI_KEY_CONFLICT'); });
test('duplicate canonical input under a new key reuses existing result', () => { reset(); finish(claim(A, 'analysis', 'one', 1, 'same-input').operation); assert.ok(claim(A, 'analysis', 'two', 1, 'same-input').replay); });
test('comparison consumes three other units and reserves all three calls', () => { reset(); const o = claim(A, 'compare', randomUUID(), 3).operation; assert.equal(Number(sql("select used from public.ai_usage_buckets where category='other'")), 3); assert.equal(Number(sql("select reserved from public.ai_usage_buckets where category='budget'")), 6330000); end(o, 400); assert.equal(Number(sql("select used from public.ai_usage_buckets where category='other'")), 0); });
test('daily counters reset by UTC date, not deleting historical usage', () => {
    reset();
    for (let i = 0; i < 5; i++)
        finish(claim().operation);
    assert.equal(claim().code, 'AI_DAILY_LIMIT');
    sql("update public.ai_usage_buckets set day=day-1;update public.ai_usage_operations set day=day-1");
    assert.ok(claim().operation);
});
test('burst starts stop at five per minute', () => {
    reset();
    for (let i = 0; i < 5; i++) {
        const o = claim(A, 'insights').operation;
        end(o, 400);
    }
    assert.equal(claim(A, 'insights').code, 'AI_BURST_LIMIT');
    sql("update public.ai_usage_operations set created_at=clock_timestamp()-interval '2 minutes'");
    assert.ok(claim(A, 'insights').operation);
});
test('budget exhaustion rejects other users before any dispatch; settings are adjustable', () => { reset(); sql('update public.ai_usage_settings set daily_budget_microusd=3000000'); assert.ok(claim().operation); assert.equal(claim(B).code, 'AI_BUDGET_LIMIT'); sql('update public.ai_usage_settings set daily_budget_microusd=5000000'); assert.ok(claim(B).operation); });
test('settled usage releases conservative excess exactly once', () => { reset(); const o = claim().operation; step(o, 'begin', 'response:0'); const receipt = { model: 'gpt-4.1', usage: { input_tokens: 20, output_tokens: 30 }, output_text: '{}' }; step(o, 'response', 'response:0', receipt); step(o, 'response', 'response:0', receipt); end(o); assert.equal(Number(sql("select spent from public.ai_usage_buckets where category='budget'")), 280); assert.equal(Number(sql("select reserved from public.ai_usage_buckets where category='budget'")), 0); });
test('undispatched failures refund quota/budget, and abandoned safe claims are cleaned', () => { reset(); const o = claim().operation; end(o, 413); assert.equal(Number(sql("select used from public.ai_usage_buckets where category='analysis'")), 0); const abandoned = claim().operation; sql(`update public.ai_usage_operations set lease_until=clock_timestamp()-interval '1 second' where id='${abandoned.id}'`); assert.ok(claim(B).operation); assert.equal(Number(sql(`select used from public.ai_usage_buckets where subject='${A}' and category='analysis'`)), 0); });
test('ambiguous AI failure retains cost and concurrency across quota reset', () => { reset(); const o = claim().operation; step(o, 'begin', 'response:0'); end(o, 500); assert.equal(sql(`select state from public.ai_usage_operations where id='${o.id}'`), 'uncertain'); assert.equal(claim(A, 'turn').code, 'AI_OUTCOME_UNCERTAIN'); assert.equal(Number(sql("select reserved from public.ai_usage_buckets where category='budget'")), 2170000); });
test('missing/negative usage never releases an ambiguous reservation', () => {
    for (const usage of [{}, { input_tokens: -1, output_tokens: 30 }]) {
        reset();
        const o = claim().operation;
        step(o, 'begin', 'response:0');
        step(o, 'response', 'response:0', { model: 'gpt-4.1', usage }, false);
        end(o, 500);
        assert.equal(sql(`select state from public.ai_usage_operations where id='${o.id}'`), 'uncertain');
    }
});
test('stale execution owner is fenced before dispatch', () => { reset(); const key = randomUUID(), o = claim(A, 'analysis', key).operation; sql(`update public.ai_usage_operations set lease_until=clock_timestamp()-interval '1 second' where id='${o.id}'`); const fresh = claim(A, 'analysis', key).operation; assert.equal(fresh.id, o.id); assert.notEqual(fresh.owner, o.owner); step(o, 'begin', 'response:0', null, false); step(fresh, 'begin', 'response:0'); });
test('persistence retry reuses the reservation and provider receipt', () => { reset(); const key = randomUUID(), o = claim(A, 'analysis', key).operation; step(o, 'begin', 'response:0'); step(o, 'response', 'response:0', { model: 'gpt-4.1', usage: { input_tokens: 20, output_tokens: 30 }, output_text: 'saved' }); end(o, 503, true); const r = claim(A, 'analysis', key).operation; assert.equal(r.id, o.id); assert.equal(r.steps['response:0'].output_text, 'saved'); assert.equal(Number(sql("select used from public.ai_usage_buckets where category='analysis'")), 1); });
test('application kill switch stops new work but permits completed replay', () => { reset(); const key = randomUUID(); finish(claim(A, 'analysis', key).operation); sql('update public.ai_usage_settings set enabled=false'); assert.equal(claim(B).code, 'AI_DISABLED'); assert.ok(claim(A, 'analysis', key).replay); });
test('analysis finalization is atomic and its replay does not insert again', () => { reset(); const o = claim().operation; const payload = { analysis: { career_profile_id: P, analysis_type: 'initial_onboarding', status: 'completed', raw_json: {}, summary: 'Synthetic' }, signals: [{ signal_name: 'Ownership', score: 4, evidence: ['Synthetic'] }], gaps: [], plan: { plan_type: 'initial', next_best_action: 'Synthetic' }, tasks: [{ title: 'Synthetic', priority: 1, status: 'not_started' }], result: { fixture: true } }; const before = Number(sql('select count(*) from public.analyses')); const bad = { ...payload, tasks: [{ title: 'Invalid synthetic', priority: 0, status: 'not_started' }] }; persist(o, 'analysis', bad, false); assert.equal(Number(sql('select count(*) from public.analyses')), before); const result = JSON.parse(persist(o, 'analysis', payload)); assert.equal(Number(sql('select count(*) from public.analyses')), before + 1); assert.deepEqual(JSON.parse(persist(o, 'analysis', payload)), result); assert.ok(result.analysisId && result.planId); });
// Real handlers and the real guard, backed by the actual migration above.
// Only Auth/metadata/Storage/OpenAI network boundaries are synthetic.
/* eslint-disable @typescript-eslint/no-explicit-any -- SDK network fixtures only. */
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let providerCalls = 0, uploads = 0, downloads = 0, providerFailure = false;
let fixtureUser: any = { id: A, is_anonymous: false };
const meta: any = { id: R, user_id: A, career_profile_id: P, file_path: `${A}/123.txt`, file_name: 'Synthetic.txt', mime_type: 'text/plain' };
let fixtureRows: Record<string, any[]> = {};
let localRecords = false, failPersistenceOnce = "";
let providerOutput: unknown = null;
function fixtureQuery(table: string) {
    const filters: Array<(row: any) => boolean> = [];
    let range = [0, Infinity];
    const rows = () => (localRecords && ["analyses", "gaps", "gap_investigations", "gap_investigation_turns", "gap_investigation_evidence"].includes(table) ? JSON.parse(sql(`select coalesce(jsonb_agg(t),'[]'::jsonb)from public.${table} t`)) : fixtureRows[table] ?? []).filter((row: any) => filters.every(f => f(row))).slice(range[0], range[1] + 1);
    const q: any = { select: () => q, eq: (k: string, v: unknown) => { filters.push(row => row[k] === v); return q; }, in: (k: string, list: unknown[]) => { filters.push(row => list.includes(row[k])); return q; }, order: () => q, range: (a: number, b: number) => { range = [a, b]; return q; }, limit: (n: number) => { range = [0, n - 1]; return q; }, maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }), then: (yes: any, no: any) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(yes, no) };
    return q;
}
const fixtureClient = { auth: { getUser: async () => ({ data: { user: fixtureUser }, error: null }) }, from: fixtureQuery };
const originalLoad = (Module as any)._load;
(Module as any)._load = function (name: string, ...rest: unknown[]) {
    if (name === 'server-only')
        return {};
    if (/(?:ai-usage\/|\.\/)store\.server(?:\.ts)?$/.test(name))
        return { usageRPC: async (name: string, values: Record<string, unknown>) => {
                if (name === 'ai_usage_persist' && values.p_kind === failPersistenceOnce) {
                    failPersistenceOnce = '';
                    throw Error('Synthetic database interruption');
                }
                assert.ok(['ai_usage_claim', 'ai_usage_step', 'ai_usage_end', 'ai_usage_persist'].includes(name));
                const literal = (v: unknown) => typeof v === 'object' ? quote(v) : typeof v === 'boolean' || typeof v === 'number' ? String(v) : "'" + String(v).replaceAll("'", "''") + "'";
                const out = sql(`set role service_role;select public.${name}(${Object.values(values).map(literal).join(',')});`);
                return out ? JSON.parse(out) : null;
            } };
    if (/lib\/supabase\/server(?:\.ts)?$/.test(name))
        return { createClient: async () => fixtureClient };
    if (/lib\/supabase\/admin(?:\.ts)?$/.test(name))
        return { supabaseAdmin: { from: fixtureQuery, storage: { from: () => ({ download: async () => { downloads++; return { data: new Blob(['Synthetic fixture']), error: null }; } }) } } };
    if (name === 'openai')
        return class {
            files = { create: async () => { uploads++; return { id: 'file-fixture' }; } };
            responses = { create: async () => {
                    providerCalls++;
                    if (providerFailure)
                        throw Error('Synthetic provider timeout');
                    return { id: 'resp-fixture', model: 'gpt-4.1', usage: { input_tokens: 20, output_tokens: 30 }, output_text: JSON.stringify(providerOutput ?? { company_name: 'Synthetic', core_verdict: 'Borderline', reasoning: 'Synthetic', score: 3 }) };
                } };
        };
    return originalLoad.call(this, name, ...rest);
};
const { POST: compare } = require('../../app/api/compare/route.ts');
const { GET: insightsGET, HEAD: insightsHEAD } = require('../../app/api/insights/narrative/route.ts');
const { GET: strategyGET, HEAD: strategyHEAD } = require('../../app/api/strategy/narrative/route.ts');
const { POST: analyze } = require('../../app/api/analyze/route.ts');
const { POST: kickoff } = require('../../app/api/gap-investigations/route.ts');
const { POST: turn } = require('../../app/api/gap-investigations/[id]/turns/route.ts');
const { POST: recommend } = require('../../app/api/gap-investigations/[id]/action-plan-recommendation/route.ts');
const { withAIUsage, aiResponse, aiFile, AIUsageError } = require('../../lib/ai-usage/guard.ts');
(Module as any)._load = originalLoad;
const compareRequest = (jobs = 1, key?: string) => new Request('http://localhost/api/compare', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify({ resume_id: R, jobDescriptions: Array.from({ length: jobs }, (_, i) => 'Synthetic job ' + i) }) });
function resetProvider() { localRecords = false; providerOutput = null; failPersistenceOnce = ""; providerCalls = 0; uploads = 0; downloads = 0; providerFailure = false; fixtureUser = { id: A, is_anonymous: false }; fixtureRows = { profiles: [{ id: A, active_career_profile_id: P }], career_profiles: [{ id: P, user_id: A }], resumes: [meta] }; }
test('real Compare handler returns 429/Retry-After and never downloads or invokes OpenAI after quota rejection', async () => {
    reset();
    resetProvider();
    for (let i = 0; i < 10; i++)
        finish(claim(A, 'compare').operation);
    const r = await compare(compareRequest());
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('Retry-After')) > 0);
    assert.equal((await r.json()).data.code, 'AI_DAILY_LIMIT');
    assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(providerCalls, 0);
    assert.equal(downloads, 0);
    assert.equal(uploads, 0);
});
test('real Compare handler remains disabled until explicit operator approval', async () => {
    reset(); resetProvider(); sql('update public.ai_usage_settings set enabled=false');
    const response = await compare(compareRequest());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).data.code, 'AI_DISABLED');
    assert.equal(providerCalls + uploads + downloads, 0);
    assert.equal(sql('select count(*) from public.ai_usage_operations'), '0');
});
test('real Compare handler respects global budget before any Storage/provider work', async () => { reset(); resetProvider(); sql('update public.ai_usage_settings set daily_budget_microusd=0'); const r = await compare(compareRequest()); assert.equal(r.status, 429); assert.equal((await r.json()).data.code, 'AI_BUDGET_LIMIT'); assert.equal(downloads + uploads + providerCalls, 0); });
for (const jobs of [1, 2, 3])
    test(`real authorized ${jobs}-job Compare settles actual SQL accounting and replays without AI`, async () => {
        reset();
        resetProvider();
        const r = await compare(compareRequest(jobs));
        assert.equal(r.status, 200);
        const body = await r.json();
        assert.equal(body.data.length, jobs);
        assert.equal(providerCalls, jobs);
        assert.equal(uploads, 1);
        assert.equal(downloads, 1);
        const replay = await compare(compareRequest(jobs));
        assert.deepEqual(await replay.json(), body);
        assert.equal(providerCalls, jobs);
        assert.equal(downloads, 1);
        assert.equal(Number(sql("select used from public.ai_usage_buckets where category='other'")), jobs);
        assert.equal(Number(sql("select spent from public.ai_usage_buckets where category='budget'")), jobs * 280);
    });
test('anonymous Auth behavior preserved: Compare denies, supported routes remain per-user limited', async () => { reset(); resetProvider(); fixtureUser.is_anonymous = true; assert.equal((await compare(compareRequest())).status, 403); assert.equal(providerCalls + downloads, 0); const anonymous = randomUUID(); assert.ok(claim(anonymous, 'analysis').operation); assert.equal(claim(anonymous, 'turn').code, 'AI_IN_PROGRESS'); });
test('provider timeout is not retried, refunded, or silently regenerated', async () => { reset(); resetProvider(); providerFailure = true; assert.equal((await compare(compareRequest())).status, 500); assert.equal(providerCalls, 1); const retry = await compare(compareRequest()); assert.equal(retry.status, 503); assert.equal((await retry.json()).data.code, 'AI_OUTCOME_UNCERTAIN'); assert.equal(providerCalls, 1); assert.equal(Number(sql("select reserved from public.ai_usage_buckets where category='budget'")), 2110000); });
test('guard resumes persistence after known provider success with zero new calls or quota', async () => {
    reset();
    resetProvider();
    const fake: any = { responses: { create: async () => { providerCalls++; return { id: 'resp', model: 'gpt-4.1', usage: { input_tokens: 1, output_tokens: 1 }, output_text: '{}' }; } } };
    let first = true;
    const execute = () => withAIUsage({ userId: A, route: 'analysis', input: 'persistence-retry' }, async () => {
        await aiResponse(fake, { model: 'gpt-4.1', input: 'Synthetic' }, 'analysis');
        if (first) {
            first = false;
            throw new AIUsageError(503, 'AI_USAGE_UNAVAILABLE');
        }
        return Response.json({ success: true, data: 'persisted' });
    });
    assert.equal((await execute()).status, 503);
    assert.equal((await execute()).status, 200);
    assert.equal(providerCalls, 1);
    assert.equal(Number(sql("select used from public.ai_usage_buckets where category='analysis'")), 1);
});
test('oversized provider input rejects before dispatch and refunds an undispatched claim', async () => { reset(); resetProvider(); const r = await withAIUsage({ userId: A, route: 'analysis', input: 'oversized' }, async () => { await aiResponse({ responses: { create: async () => { providerCalls++; } } }, { model: 'gpt-4.1', input: 'x'.repeat(512 * 1024 + 1) }, 'analysis'); return Response.json({ success: true }); }); assert.equal(r.status, 413); assert.equal(providerCalls, 0); assert.equal(Number(sql("select used from public.ai_usage_buckets where category='analysis'")), 0); });
test('explicit narrative HEAD handlers never generate or reserve', async () => { reset(); resetProvider(); assert.equal((await insightsHEAD()).status, 200); assert.equal((await strategyHEAD()).status, 200); assert.equal(providerCalls + uploads + downloads, 0); assert.equal(Number(sql('select count(*) from public.ai_usage_operations')), 0); });
test('pending reservations from prior days still constrain the new daily budget', () => { reset(); sql('update public.ai_usage_settings set daily_budget_microusd=3000000'); const o = claim().operation; step(o, 'begin', 'response:0'); end(o, 500); sql("update public.ai_usage_operations set day=day-1;update public.ai_usage_buckets set day=day-1"); assert.equal(claim(B).code, 'AI_BUDGET_LIMIT'); });
test('independent clients cannot oversubscribe global budget', async () => { reset(); sql('update public.ai_usage_settings set daily_budget_microusd=5000000'); const json = await Promise.all(Array.from({ length: 8 }, () => new Promise<any>((resolve, reject) => execFile('psql', [...args, '-c', claimSQL(randomUUID())], { env }, (e, out) => e ? reject(e) : resolve(JSON.parse(out.trim())))))); assert.equal(json.filter(r => r.operation).length, 2); assert.equal(json.filter(r => r.code === 'AI_BUDGET_LIMIT').length, 6); assert.equal(Number(sql("select sum(reserved) from public.ai_usage_buckets where category='budget'")), 4340000); });
test('investigation answer and assistant persistence are idempotent and keep indexes stable', () => {
    reset();
    const aid = randomUUID(), gid = randomUUID(), iid = randomUUID();
    sql(`insert into public.analyses(id,user_id,career_profile_id,analysis_type,status,raw_json)values('${aid}','${A}','${P}','initial_onboarding','completed','{}');insert into public.gaps(id,analysis_id,user_id,gap_title,gap_description,priority)values('${gid}','${aid}','${A}','Synthetic','Synthetic',1);insert into public.gap_investigations(id,user_id,career_profile_id,seed_gap_id,seed_analysis_id)values('${iid}','${A}','${P}','${gid}','${aid}');insert into public.gap_investigation_turns(investigation_id,user_id,role,content,turn_index)values('${iid}','${A}','assistant','Synthetic kickoff',0);`);
    const o = claim(A, 'turn').operation;
    const answer = { investigation_id: iid, role: 'user', content: 'Synthetic answer', turn_index: 1 };
    assert.deepEqual(JSON.parse(persist(o, 'user_turn', answer)), JSON.parse(persist(o, 'user_turn', answer)));
    const assistant = { investigation_id: iid, role: 'assistant', content: 'Synthetic response', turn_index: 2 };
    persist(o, 'assistant_turn', assistant);
    persist(o, 'assistant_turn', assistant);
    assert.equal(sql(`select string_agg(turn_index::text,',' order by turn_index)from public.gap_investigation_turns where investigation_id='${iid}'`), '0,1,2');
    persist(o, 'investigation_update', { id: iid, turn_count: 1 });
    assert.equal(sql(`select turn_count from public.gap_investigations where id='${iid}'`), '1');
});
const IA = '55555555-5555-4555-8555-555555555555', GI = '66666666-6666-4666-8666-666666666666', GP = '77777777-7777-4777-8777-777777777777';
function routeFixtures() { resetProvider(); fixtureRows.analyses = [{ id: IA, user_id: A, career_profile_id: P, resume_id: R, raw_json: { signals: [{ signal_name: 'Leadership', score: 4 }], gaps: [{ gap_title: 'Scope' }], role_requirements: [{ requirement: 'Scope' }] } }]; fixtureRows.gaps = [{ id: GP, analysis_id: IA, user_id: A, gap_code: 'strategy', gap_title: 'Scope' }]; fixtureRows.gap_investigations = [{ id: GI, user_id: A, career_profile_id: P, seed_analysis_id: IA, seed_gap_id: GP, status: 'active', turn_count: 0, context_snapshot: { target: { role: 'PM', level: 'Senior' }, gap: { gap_title: 'Scope' } } }]; fixtureRows.gap_investigation_turns = [{ id: '88888888-8888-4888-8888-888888888888', investigation_id: GI, user_id: A, role: 'assistant', content: 'Synthetic question', turn_index: 0 }]; fixtureRows.gap_investigation_evidence = [{ id: '99999999-9999-4999-8999-999999999999', investigation_id: GI, user_id: A, user_status: 'confirmed', source_type: 'user', claim: 'Synthetic validated candidate experience.' }]; }
const postBody = (body: unknown) => new Request('http://localhost/api/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
for (const route of ['analysis', 'kickoff', 'turn', 'recommendation', 'insights', 'strategy'])
  for (const mode of ['quota', 'disabled'])
    test(`${route} production route rejects ${mode} with zero Storage/uploads/provider calls`, async () => {
        reset();
        routeFixtures();
        const category = route === 'analysis' ? 'analysis' : ['kickoff', 'turn'].includes(route) ? 'gap' : 'other';
        const limit = category === 'analysis' ? 5 : category === 'gap' ? 20 : 10;
        if (mode === 'disabled') sql('update public.ai_usage_settings set enabled=false');
        else sql(`insert into public.ai_usage_buckets(day,subject,category,used)values((clock_timestamp() at time zone 'UTC')::date,'${A}','${category}',${limit})`);
        let r: Response;
        if (route === 'analysis')
            r = await analyze(postBody({ resume_id: R, jobDescription: 'Synthetic JD' }));
        else if (route === 'kickoff') {
            fixtureRows.gap_investigations = [];
            r = await kickoff(postBody({ gap_id: GP }));
        }
        else if (route === 'turn')
            r = await turn(postBody({ content: 'Synthetic answer' }), { params: Promise.resolve({ id: GI }) });
        else if (route === 'recommendation') {
            fixtureRows.gap_investigations[0].status = 'concluded';
            r = await recommend(postBody({}), { params: Promise.resolve({ id: GI }) });
        }
        else
            r = await (route === 'insights' ? insightsGET : strategyGET)();
        assert.equal(r.status, mode === 'disabled' ? 503 : 429, JSON.stringify(await r.clone().json()));
        assert.equal((await r.json()).data.code, mode === 'disabled' ? 'AI_DISABLED' : 'AI_DAILY_LIMIT');
        assert.equal(providerCalls + uploads + downloads, 0);
        assert.ok(Number(r.headers.get('Retry-After')) > 0);
    });
test('real Analyze transaction preserves the successful response and never regenerates a completed retry', async () => {
    reset();
    resetProvider();
    providerOutput = { positioning_summary: 'Synthetic', core_verdict: 'Borderline', signals: [{ signal_name: 'Ownership', score: 4, evidence: ['Synthetic'], risk_level: 'low' }], gaps: [{ gap_title: 'Scope', gap_description: 'Synthetic', priority: 0, recommended_fix: 'Synthetic' }], plan: { next_best_action: 'Synthetic', tasks: [{ title: 'Synthetic', description: 'Synthetic', priority: 1, task_type: 'resume' }] } };
    const request = () => postBody({ resume_id: R, jobDescription: 'Synthetic JD' });
    const first = await analyze(request());
    assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
    const result = await first.json();
    assert.deepEqual(result.data.result, providerOutput);
    assert.ok(result.data.analysisId && result.data.planId);
    assert.equal(sql(`select priority from public.gaps where analysis_id='${result.data.analysisId}'`), '1');
    assert.deepEqual(await (await analyze(request())).json(), result);
    assert.equal(providerCalls, 1);
    assert.equal(downloads, 1);
    assert.equal(Number(sql(`select count(*)from public.plans where analysis_id='${result.data.analysisId}'`)), 1);
});
test('real investigation retry restores its saved user answer and provider output after assistant persistence failure', async () => {
    reset();
    routeFixtures();
    localRecords = true;
    const aid = randomUUID(), gid = randomUUID(), iid = randomUUID(), tid = randomUUID();
    sql(`insert into public.analyses(id,user_id,career_profile_id,analysis_type,status,raw_json)values('${aid}','${A}','${P}','initial_onboarding','completed','{}');insert into public.gaps(id,analysis_id,user_id,gap_title,gap_description,priority)values('${gid}','${aid}','${A}','Synthetic','Synthetic',1);insert into public.gap_investigations(id,user_id,career_profile_id,seed_gap_id,seed_analysis_id,context_snapshot)values('${iid}','${A}','${P}','${gid}','${aid}','{"gap":{"gap_title":"Scope"},"target":{"role":"PM","level":"Senior"},"analysis":{"id":"${aid}","related_signals":[]},"resume":{"id":null}}');insert into public.gap_investigation_turns(id,investigation_id,user_id,role,content,turn_index)values('${tid}','${iid}','${A}','assistant','Synthetic kickoff',0);`);
    providerOutput = { action: 'ask_question', next_question: 'Synthetic follow-up?', candidate_evidence: [] };
    failPersistenceOnce = 'assistant_turn';
    const request = () => postBody({ content: 'Synthetic answer', parent_turn_id: tid });
    const params = { params: Promise.resolve({ id: iid }) };
    const first = await turn(request(), params);
    assert.equal(first.status, 503, JSON.stringify(await first.clone().json()));
    assert.equal(Number(sql(`select count(*)from public.gap_investigation_turns where investigation_id='${iid}' and role='user'`)), 1);
    const recovered = await turn(request(), params);
    assert.equal(recovered.status, 200, JSON.stringify(await recovered.clone().json()));
    const body = await recovered.json();
    assert.equal(body.data.turns.length, 3);
    assert.equal(body.data.investigation.turn_count, 1);
    assert.equal(providerCalls, 1);
    assert.equal(Number(sql("select used from public.ai_usage_buckets where category='gap'")), 1);
    assert.deepEqual(await (await turn(request(), params)).json(), body);
    assert.equal(providerCalls, 1);
    localRecords = false;
});
for (const route of ['insights', 'strategy'])
    test(`${route} cache hit remains free even with AI disabled and no budget`, async () => {
        reset();
        routeFixtures();
        sql('update public.ai_usage_settings set enabled=false,daily_budget_microusd=0');
        const signal = { name: 'Leadership', count: 1 }, gap = { name: 'Scope', count: 1 };
        const source_hash = createHash('sha256').update(JSON.stringify({ top_signal: signal, top_gap: gap, top_signals: [signal], top_gaps: [gap], recommended_focus: ['Scope'], total_analyses: 1 })).digest('hex');
        fixtureRows[route === 'insights' ? 'insight_narratives' : 'strategy_narratives'] = [{ user_id: A, source_hash, career_summary: 'Cached', coaching_insight: 'Cached', recommended_focus: 'Cached', target_positioning: 'Cached', strategic_direction: 'Cached', where_to_focus: [], where_to_avoid: [], positioning_tradeoffs: [], narrative_to_tell: 'Cached', risks: [] }];
        const r = await (route === 'insights' ? insightsGET : strategyGET)();
        assert.equal(r.status, 200);
        assert.equal((await r.json()).cached, true);
        assert.equal(providerCalls + uploads + downloads, 0);
        assert.equal(Number(sql('select count(*)from public.ai_usage_operations')), 0);
    });
test('definitive provider rejection releases budget but still counts the dispatched attempt', async () => {
    reset();
    const fake: any = { responses: { create: async () => { throw Object.assign(new Error('Sensitive upstream detail'), { status: 400 }); } } };
    const r = await withAIUsage({ userId: A, route: 'analysis', input: 'definitively-rejected' }, async () => { await aiResponse(fake, { model: 'gpt-4.1', input: 'Synthetic' }, 'analysis'); return Response.json({ success: true }); });
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(await r.json()).includes('Sensitive'));
    assert.equal(Number(sql("select reserved from public.ai_usage_buckets where category='budget'")), 0);
    assert.equal(Number(sql("select used from public.ai_usage_buckets where category='analysis'")), 1);
    assert.ok(claim(A, 'turn').operation);
});
test('transient pre-dispatch failure can resume without duplicate quota, or be abandoned safely', async () => {
    reset();
    let first = true;
    const execute = () => withAIUsage({ userId: A, route: 'analysis', input: 'pre-dispatch' }, async () => {
        if (first) {
            first = false;
            throw Error('Synthetic Storage outage');
        }
        return Response.json({ success: true });
    });
    assert.equal((await execute()).status, 500);
    assert.equal((await execute()).status, 200);
    assert.equal(Number(sql("select used from public.ai_usage_buckets where category='analysis'")), 0);
    assert.equal(Number(sql("select reserved from public.ai_usage_buckets where category='budget'")), 0);
});
test('oversized investigation context leaves no orphan user answer and dispatches no AI', async () => {
    reset();
    routeFixtures();
    fixtureRows.gap_investigation_evidence[0].claim = 'x'.repeat(500 * 1024);
    const r = await turn(postBody({ content: 'Synthetic answer' }), { params: Promise.resolve({ id: GI }) });
    assert.equal(r.status, 413);
    assert.equal(providerCalls + uploads + downloads, 0);
    assert.equal(Number(sql("select count(*)from public.ai_usage_operations where steps ? 'persist:user_turn'")), 0);
    assert.equal(Number(sql("select used from public.ai_usage_buckets where category='gap'")), 0);
});
test('new operations cannot append a second user answer while an earlier answer needs recovery', () => {
    reset();
    const iid = randomUUID();
    sql(`insert into public.gap_investigations(id,user_id,career_profile_id)values('${iid}','${A}','${P}');insert into public.gap_investigation_turns(investigation_id,user_id,role,content,turn_index)values('${iid}','${A}','user','Synthetic pending',0);`);
    const o = claim(A, 'turn').operation;
    persist(o, 'user_turn', { investigation_id: iid, role: 'user', content: 'Second answer', turn_index: 1 }, false);
    assert.equal(sql(`select count(*)from public.gap_investigation_turns where investigation_id='${iid}'`), '1');
});
test('duplicate request aliases cannot later authorize changed payloads', () => { reset(); finish(claim(A, 'analysis', 'first-key', 1, 'same-body').operation); assert.ok(claim(A, 'analysis', 'alias-key', 1, 'same-body').replay); assert.equal(claim(A, 'analysis', 'alias-key', 1, 'changed-body').code, 'AI_KEY_CONFLICT'); });
test('completed replay payloads expire after 24 hours without erasing usage counters', () => { reset(); const key = randomUUID(); const old = claim(A, 'analysis', key).operation; finish(old); sql(`update public.ai_usage_operations set updated_at=clock_timestamp()-interval '25 hours' where id='${old.id}'`); const fresh = claim(A, 'analysis', key).operation; assert.ok(fresh); assert.notEqual(fresh.id, old.id); assert.equal(Number(sql("select used from public.ai_usage_buckets where category='analysis'")), 2); });
test('all application generation adapters set explicit output, timeout and retry bounds', async () => {
    const caps: Record<string, number> = { analysis: 8192, compare: 1536, kickoff: 4096, turn: 4096, recommendation: 2400, insights: 800, strategy: 1600 };
    for (const [route, cap] of Object.entries(caps)) {
        reset();
        let observed: any;
        const fake: any = { responses: { create: async (params: any, options: any) => { observed = { params, options }; return { id: 'synthetic-response', model: 'gpt-4.1', usage: { input_tokens: 10, output_tokens: 10 }, output_text: '{}' }; } } };
        const r = await withAIUsage({ userId: A, route, input: route }, async () => { await aiResponse(fake, { model: 'gpt-4.1', input: 'Synthetic' }, route); return Response.json({ success: true }); });
        assert.equal(r.status, 200);
        assert.equal(observed.params.max_output_tokens, cap);
        assert.equal(observed.options.maxRetries, 0);
        assert.equal(observed.options.timeout, 60000);
        assert.match(observed.options.headers['X-Client-Request-Id'], /^[a-f0-9-]+-response:0$/);
    }
});
test('missing settings fails closed for new admission, recovered claims and pending dispatch',()=>{
 reset();const key=randomUUID(),o=claim(A,'analysis',key).operation;sql(`update public.ai_usage_operations set lease_until=clock_timestamp()-interval '1 second' where id='${o.id}';delete from public.ai_usage_settings;`);
 try {assert.equal(claim(A,'analysis',key).code,'AI_DISABLED');assert.equal(claim(B).code,'AI_DISABLED');}
 finally {sql('insert into public.ai_usage_settings(id,enabled,daily_budget_microusd)values(true,true,100000000)');}
 const recovered=claim(A,'analysis',key).operation;sql('delete from public.ai_usage_settings');try{step(recovered,'begin','response:0',null,false);}finally{sql('insert into public.ai_usage_settings(id,enabled,daily_budget_microusd)values(true,true,100000000)');}
 assert.equal(sql(`select calls from public.ai_usage_operations where id='${o.id}'`),'0');
});
test('unavailable accounting store returns 503 with zero provider or privileged Storage calls',async()=>{
 reset();resetProvider();sql("revoke execute on function public.ai_usage_claim(uuid,text,text,text,integer)from service_role");
 try{const r=await compare(compareRequest());assert.equal(r.status,503);assert.equal((await r.json()).data.code,'AI_USAGE_UNAVAILABLE');assert.equal(providerCalls+uploads+downloads,0);}
 finally{sql("grant execute on function public.ai_usage_claim(uuid,text,text,text,integer)to service_role");}
});
test('concurrent duplicate HTTP requests generate once and consume one quota unit',async()=>{
 reset();resetProvider();const results=await Promise.all([compare(compareRequest(1,'same-request')),compare(compareRequest(1,'same-request'))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,429]);assert.equal(providerCalls,1);assert.equal(downloads,1);assert.equal(uploads,1);assert.equal(Number(sql("select used from public.ai_usage_buckets where category='other'")),1);
});
test('a safely expired/refunded claim can be readmitted under the same client key, with the old owner fenced',()=>{
 reset();const key=randomUUID(),old=claim(A,'analysis',key).operation;sql(`update public.ai_usage_operations set lease_until=clock_timestamp()-interval '1 second' where id='${old.id}'`);const other=claim(B).operation;end(other,400);
 const fresh=claim(A,'analysis',key).operation;assert.ok(fresh);assert.notEqual(fresh.id,old.id);step(old,'begin','response:0',null,false);assert.equal(Number(sql(`select used from public.ai_usage_buckets where subject='${A}' and category='analysis'`)),1);
});
test('a conclusively failed comparison refunds units for jobs never dispatched',()=>{reset();const o=claim(A,'compare',randomUUID(),3).operation;step(o,'begin','response:0');step(o,'response','response:0',{model:'gpt-4.1',usage:{input_tokens:20,output_tokens:30},output_text:'{}'});end(o,500);assert.equal(Number(sql("select used from public.ai_usage_buckets where category='other'")),1);assert.equal(Number(sql("select reserved from public.ai_usage_buckets where category='budget'")),0);});
test('migration refuses an unsafe server-role prerequisite without altering existing objects', () => { reset(); const migration = readFileSync('supabase/migrations/20261103000001_ai_usage_guard.sql', 'utf8'); sql('begin;alter role service_role nobypassrls;' + migration, false); assert.equal(sql("select rolbypassrls from pg_roles where rolname='service_role'"), 't'); assert.equal(sql("select count(*)from public.ai_usage_settings"), '1'); });
test('expired pre-provider claim with a persisted answer requires original-operation recovery, not refund/deletion', () => {
    reset();
    const key = randomUUID(), o = claim(A, 'turn', key).operation;
    sql(`update public.ai_usage_operations set steps=jsonb_build_object('persist:user_turn',jsonb_build_object('id','synthetic')),lease_until=clock_timestamp()-interval '1 second' where id='${o.id}'`);
    assert.equal(claim(A, 'analysis').code, 'AI_RECOVERY_REQUIRED');
    const recovered = claim(A, 'turn', key).operation;
    assert.equal(recovered.id, o.id);
    assert.ok(recovered.steps['persist:user_turn']);
    assert.equal(Number(sql("select used from public.ai_usage_buckets where category='gap'")), 1);
});
test('operational rollback pauses AI and preserves uncertain holds, receipts and private permissions', () => {
    reset();
    const key = randomUUID();
    finish(claim(A, 'analysis', key).operation);
    const uncertain = claim(B).operation;
    step(uncertain, 'begin', 'response:0');
    end(uncertain, 500);
    const held = sql("select reserved from public.ai_usage_buckets where category='budget'");
    sql(readFileSync('supabase/rollback/20261103000001_ai_usage_guard.sql', 'utf8'));
    assert.equal(claim(A, 'turn').code, 'AI_DISABLED');
    assert.ok(claim(A, 'analysis', key).replay);
    for (const signature of ['ai_usage_step(uuid,uuid,text,text,jsonb)', 'ai_usage_persist(uuid,uuid,text,jsonb)'])
        assert.equal(sql(`select has_function_privilege('service_role','public.${signature}','execute')`), 'f');
    assert.equal(sql(`select state from public.ai_usage_operations where id='${uncertain.id}'`), 'uncertain');
    assert.equal(sql("select reserved from public.ai_usage_buckets where category='budget'"), held);
    assert.equal(sql('select count(*) from public.ai_usage_operations'), '2');
    assert.equal(sql("select count(*) from public.ai_usage_operations where steps ? 'response:0'"), '1');
    sql('set role authenticated;select * from public.ai_usage_operations', false);
});
test('provider adapter refuses unguarded application generation or uploads', async () => {
    const fake: any = { responses: { create: async () => { throw Error('Unexpected provider call'); } }, files: { create: async () => { throw Error('Unexpected upload'); } } };
    await assert.rejects(aiResponse(fake, { model: 'gpt-4.1', input: 'Synthetic' }, 'analysis'), (error: any) => error.code === 'AI_OPERATION_REQUIRED');
    await assert.rejects(aiFile(fake, new File(['Synthetic'], 'synthetic.txt')), (error: any) => error.code === 'AI_OPERATION_REQUIRED');
});
