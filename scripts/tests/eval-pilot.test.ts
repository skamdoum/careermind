import assert from "node:assert/strict";
import { test } from "node:test";
import OpenAI from "openai";
import { PilotGuard } from "../eval/pilot-guard";
const endpoint = "https://api.openai.com/v1/responses";
const params = (model = "gpt-6-luna") => ({ method: "POST", body: JSON.stringify({ model, reasoning: model === "gpt-6-luna" ? { effort: "none" } : undefined, input: "Synthetic" }) });
const receipt = (input = 100, output = 100) => Response.json({ id: "synthetic", status: "completed", usage: { input_tokens: input, output_tokens: output }, output: [] });
const setup = () => { const g = new PilotGuard(1232); g.beginScenario("GI-01"); return g; };
test("pre-run worst case covers all calls with margin and fits comfortably under $5", () => {
  const g = setup(); assert.ok(g.maximumUsd() < 4); assert.ok(g.maximumUsd() > 3);
  assert.throws(() => new PilotGuard(1232, 1), /Worst-case/);
  assert.throws(() => new PilotGuard(1232, 6), /threshold/);
  assert.throws(() => new PilotGuard(9000), /fixtures/);
});
test("transport caps output, reserves before dispatch and accounts receipts", async () => {
  const g = setup();
  const fetcher = g.wrap(async (_url, init) => {
    assert.ok(g.reservedUsd > 0);
    const body = JSON.parse(String(init?.body)); assert.equal(body.max_output_tokens, 4096); assert.equal(body.service_tier, "default");
    return receipt();
  });
  await fetcher(endpoint, params());
  assert.equal(g.agentCalls, 1); assert.equal(g.estimatedUsd, 0.00006); assert.equal(g.receipts.length, 1);
});
test("all API paths except models, fixture uploads and Responses are denied", async () => {
  for (const url of ["https://example.com", "https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/responses/background"]) {
    const g = setup(); let calls = 0;
    await assert.rejects(g.wrap(async () => { calls++; return receipt(); })(url, params())); assert.equal(calls, 0);
  }
});
test("agent turn and judge call limits stop before extra dispatch", async () => {
  for (const agent of [true, false]) {
    const g = setup(); let calls = 0;
    const f = g.wrap(async () => { calls++; return receipt(); });
    if (agent) for (let i = 0; i < 8; i++) await f(endpoint, params());
    else { g.judgeCalls = 200; }
    await assert.rejects(f(endpoint, params(agent ? "gpt-6-luna" : "gpt-4.1-mini")), /limit/);
    assert.equal(calls, agent ? 8 : 0);
  }
});
test("scenario/run limits and spending threshold fail closed", async () => {
  const g = setup(); assert.throws(() => g.beginScenario("GI-01"), /limit/);
  const h = setup(); h.reservedUsd = 5;
  await assert.rejects(h.wrap(async () => { throw Error("must not dispatch"); })(endpoint, params()), /spending/);
  const j = setup(); for (let i = 2; i <= 5; i++) j.beginScenario(`GI-${i}`);
  assert.throws(() => j.beginScenario("sixth"), /limit/);
});
test("input limits, unapproved models and retries are blocked before dispatch", async () => {
  for (const init of [{ ...params(), headers: { "x-stainless-retry-count": "1" } }, params("gpt-6-sol"),
    { ...params(), body: JSON.stringify({ model: "gpt-6-luna", reasoning: { effort: "none" }, input: "x".repeat(70000) }) }]) {
    const g = setup(); let calls = 0;
    await assert.rejects(g.wrap(async () => { calls++; return receipt(); })(endpoint, init)); assert.equal(calls, 0);
  }
});
test("provider errors and incomplete responses permanently stop further dispatch and retain reservations", async () => {
  for (const fail of [async () => new Response("error", { status: 429 }), async () => { throw Error("timeout"); }, async () => Response.json({ status: "incomplete" })]) {
    const g = setup(); let calls = 0; const f = g.wrap(async () => { calls++; return fail(); });
    await assert.rejects(f(endpoint, params())); assert.ok(g.reservedUsd > 0);
    await assert.rejects(f(endpoint, params())); assert.equal(calls, 1);
  }
});
test("SDK requests use the guarded transport with zero retries, including HTTP errors", async () => {
  const g = setup(); let calls = 0;
  const client = new OpenAI({ apiKey: "synthetic", maxRetries: 0, fetch: g.wrap(async (_url, init) => {
    calls++; assert.equal(new Headers(init?.headers).get("x-stainless-retry-count"), "0");
    return new Response("error", { status: 500 });
  }) });
  await assert.rejects(client.responses.create({ model: "gpt-6-luna", reasoning: { effort: "none" }, input: "Synthetic" }));
  assert.equal(calls, 1); assert.ok(g.stopped);
});
test("model access and bounded synthetic uploads pass without generation", async () => {
  const g = setup(); const f = g.wrap(async () => Response.json({ id: "fixture" }));
  await f("https://api.openai.com/v1/models/gpt-6-luna", { method: "GET" });
  const body = new FormData(); body.set("file", new File(["synthetic"], "resume.txt", { type: "text/plain" })); body.set("purpose", "user_data");
  await f("https://api.openai.com/v1/files", { method: "POST", body });
  assert.equal(g.uploads, 1); assert.equal(g.estimatedUsd, 0); assert.equal(g.reservedUsd, 0.01);
});

test("SDK default fetch cannot bypass the installed evaluation boundary", async () => {
  const original = globalThis.fetch; const g = setup(); let calls = 0;
  globalThis.fetch = g.wrap(async () => { calls++; return receipt(); });
  try {
    const client = new OpenAI({ apiKey: "synthetic", maxRetries: 0 });
    await client.responses.create({ model: "gpt-6-luna", reasoning: { effort: "none" }, input: "Synthetic" });
    assert.equal(calls, 1); assert.equal(g.receipts.length, 1);
  } finally { globalThis.fetch = original; }
});

test("real SDK multipart upload is covered without local probe/network bypass", async () => {
  const g = setup(); let calls = 0;
  const client = new OpenAI({ apiKey: "synthetic", maxRetries: 0, fetch: g.wrap(async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/files");
    assert.ok(init?.body instanceof FormData); calls++;
    return Response.json({ id: "file-synthetic", object: "file" });
  }) });
  await client.files.create({ file: new File(["synthetic"], "fixture.txt", { type: "text/plain" }), purpose: "user_data" });
  assert.equal(calls, 1); assert.equal(g.uploads, 1); assert.equal(g.stopped, null);
});

test("judge outputs are capped and judge token costs are included", async () => {
  const g = setup();
  await g.wrap(async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).max_output_tokens, 1024);
    return receipt();
  })(endpoint, params("gpt-4.1-mini"));
  assert.equal(g.judgeCalls, 1); assert.equal(g.estimatedUsd, 0.0002);
});
test("global agent call and upload maxima prevent extra requests", async () => {
  const g = setup(); g.agentCalls = 35; let calls = 0;
  await assert.rejects(g.wrap(async () => { calls++; return receipt(); })(endpoint, params()), /turn limit/);
  assert.equal(calls, 0);
  const h = setup(); h.uploads = 5;
  const body = new FormData(); body.set("file", new File(["fixture"], "fixture.txt", { type: "text/plain" })); body.set("purpose", "user_data");
  await assert.rejects(h.wrap(async () => { calls++; return receipt(); })("https://api.openai.com/v1/files", { method: "POST", body }), /upload limit/);
  assert.equal(calls, 0);
});
test("unexpected receipt usage retains reservation and stops", async () => {
  const g = setup(); await assert.rejects(g.wrap(async () => receipt(1e6, 100))(endpoint, params()), /reservation/);
  assert.ok(g.stopped); assert.ok(g.reservedUsd > 0);
});

test("GI-01 mode bounds the entire diagnostic below $1 and rejects repeats/other scenarios", async () => {
  const { validatePilotSelection } = await import("../eval/pilot-guard");
  const selection = { ids: ["GI-01-strong-hidden-evidence"], runs: 1, candidate: "gpt-6-luna", judge: "gpt-4.1-mini", effort: "none", skipJudges: false, diagnostic: true };
  validatePilotSelection(selection);
  for (const invalid of [{ ...selection, ids: ["GI-02-genuine-capability-gap"] }, { ...selection, runs: 2 }, { ...selection, candidate: "gpt-6-sol" }, { ...selection, skipJudges: true }]) assert.throws(() => validatePilotSelection(invalid));
  const g = new PilotGuard(1049, 1, true);
  assert.ok(g.maximumUsd() < 0.75); assert.equal(g.limits.agentCalls, 7); assert.equal(g.limits.judgeCalls, 40);
  assert.throws(() => new PilotGuard(1049, 1.1, true), /threshold/);
  assert.throws(() => g.beginScenario("GI-02"), /GI-01 only/);
  const h = new PilotGuard(1049, 1, true); h.beginScenario(selection.ids[0]);
  assert.throws(() => h.beginScenario(selection.ids[0]), /scenario\/run limit/);
});

test("GI-01-specific call caps block dispatch", async () => {
  for (const agent of [true, false]) {
    const g = new PilotGuard(1049, 1, true); g.beginScenario("GI-01-strong-hidden-evidence");
    if (agent) g.agentCalls = 7; else g.judgeCalls = 40;
    let calls = 0;
    await assert.rejects(g.wrap(async () => { calls++; return receipt(); })(endpoint, params(agent ? "gpt-6-luna" : "gpt-4.1-mini")), /limit/);
    assert.equal(calls, 0);
  }
});

test("structured output diagnostics distinguish parsing, refusal and SDK-envelope failures", async () => {
  const { inspectOutput } = await import("../eval/pilot-guard");
  assert.equal(inspectOutput([{ type: "message", content: [{ type: "output_text", text: "{bad" }] }]).stage, "json_parsing");
  assert.equal(inspectOutput([{ type: "message", content: [{ type: "refusal", refusal: "Synthetic" }] }]).refusal, true);
  assert.equal(inspectOutput([{ type: "message", content: null }]).stage, "sdk_interpretation");
  assert.equal(inspectOutput([{ type: "message", content: [{ type: "output_text", text: '{"action":"ask_question"}' }] }]).stage, "json_parsed");
});

test("diagnostic serialization redacts credentials and local identity while retaining frames", async () => {
  const { diagnosticJSON } = await import("../eval/pilot-guard");
  const original = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "synthetic-secret-key";
    const saved = diagnosticJSON({ stack: `SyntaxError at ${process.cwd()}/agent.ts:1:2`, detail: "synthetic-secret-key Bearer private-token" });
    assert.ok(!saved.includes(process.cwd())); assert.ok(!saved.includes("synthetic-secret-key")); assert.ok(!saved.includes("private-token"));
    assert.match(saved, /SyntaxError/); assert.match(saved, /agent.ts:1:2/);
  } finally { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; }
});

test("incomplete responses retain known billable usage, output diagnostics and latency before stopping", async () => {
  const g = new PilotGuard(1049, 1, true); g.beginScenario("GI-01-strong-hidden-evidence");
  await assert.rejects(g.wrap(async () => Response.json({ id: "synthetic-incomplete", model: "gpt-6-luna", status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 100, output_tokens: 4096 },
    output: [{ type: "message", content: [{ type: "output_text", text: '{} trailing {}' }] }],
  }))(endpoint, params()), /Incomplete/);
  assert.equal(g.estimatedUsd, (100 * 0.1 + 4096 * 0.5) / 1e6);
  assert.equal(g.receipts.length, 1); assert.equal(g.receipts[0].providerStatus, "incomplete");
  assert.deepEqual(g.receipts[0].incompleteDetails, { reason: "max_output_tokens" });
  assert.ok(g.receipts[0].latencyMs >= 0); assert.ok(g.reservedUsd > 0);
});
