/* eslint-disable @typescript-eslint/no-explicit-any -- Test doubles at SDK/module boundaries. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import { providerEvent, PRICING_VERSION } from "../../lib/ai-usage/telemetry";

const require = createRequire(import.meta.url);
let writeFailure = false;
const rows = new Map<string, any>();
const admin = { from(table: string) {
  assert.equal(table, "telemetry_events");
  return { insert(row: any) {
    return { async abortSignal(signal: AbortSignal) {
      assert.ok(signal instanceof AbortSignal);
      if (writeFailure) throw new Error("private transport error must not escape");
      if (rows.has(row.event_key) || [...rows.values()].some(existing =>
        row.provider_response_id !== null && existing.provider_response_id === row.provider_response_id)) {
        return { error: { code: "23505", details: "private receipt details" } };
      }
      rows.set(row.event_key, row);
      return { error: null };
    } };
  }, select(columns: string) {
    assert.equal(columns, "operation_id,call_index,user_id,provider_response_id");
    return { eq(key: string, value: string) {
      assert.equal(key, "event_key");
      return { abortSignal(signal: AbortSignal) {
        assert.ok(signal instanceof AbortSignal);
        return { async maybeSingle() { return { data: rows.get(value) ?? null, error: null }; } };
      } };
    } };
  }, update(changes: any) {
    const filters: Record<string, unknown> = {};
    const query = { eq(key: string, value: unknown) { filters[key] = value; return query; }, async abortSignal() {
      if (writeFailure) throw new Error("private transport error");
      for (const row of rows.values()) if (row.operation_id === filters.operation_id && row.user_id === filters.user_id) Object.assign(row, changes);
      return { error: null };
    } };
    return query;
  } };
} };
const original = (Module as any)._load;
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (name === "server-only") return {};
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(name)) return { supabaseAdmin: admin };
  if (/ai-usage\/store.server(?:\.ts)?$/.test(name) || name === "./store.server") return { usageRPC: async () => ({ analysisId: "analysis-created" }) };
  return original.call(this, name, ...args);
};
// Load the real store while only its network/client boundary is replaced.
const { insertProviderEvent } = require("../../lib/ai-usage/telemetry-store.server.ts");
const { aiResponse, providerContext } = require("../../lib/ai-usage/provider.ts");
const { persistAIRecords } = require("../../lib/ai-usage/guard.ts");
(Module as any)._load = original;

const base = { operationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", callIndex: 0,
  route: "analysis" as const, latencyMs: 12.5, model: "gpt-4.1-2025-04-14", outcome: "success" as const };
const receipt = { id: "resp_synthetic", model: base.model, status: "completed", output_text: "NOT VALID JSON",
  usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 400 }, output_tokens: 50 } };
test("matching duplicate writes are quiet and keep the original measurement", async (t) => {
  rows.clear();
  const warning = t.mock.method(console, "warn", () => {});
  for (const responseId of [receipt.id, undefined]) {
    const event = providerEvent({ ...base, callIndex: rows.size, responseId, usage: receipt.usage });
    await insertProviderEvent(event);
    await insertProviderEvent({ ...event, latency_ms: 99 });
    assert.deepEqual(rows.get(event.event_key), event);
  }
  assert.equal(rows.size, 2);
  assert.equal(warning.mock.callCount(), 0);
});
test("receipt identity conflicts warn without leaking details or overwriting", async (t) => {
  rows.clear();
  const warning = t.mock.method(console, "warn", () => {});
  const event = providerEvent({ ...base, responseId: receipt.id, usage: receipt.usage });
  await insertProviderEvent(event);
  await insertProviderEvent(providerEvent({ ...base, callIndex: 1, responseId: receipt.id }));
  await insertProviderEvent({ ...event, provider_response_id: "resp_different" });
  assert.deepEqual([...rows.values()], [event]);
  assert.deepEqual(warning.mock.calls.map(call => call.arguments),
    [["[telemetry] provider receipt identity conflict"], ["[telemetry] provider receipt identity conflict"]]);
});
function context(overrides = {}) {
  return { op: { id: base.operationId, owner: "fence", steps: {} }, call: 0, upload: 0, providerError: false,
    userId: base.userId, telemetry: { investigation_id: "33333333-3333-4333-8333-333333333333" }, step: async () => null, ...overrides };
}
test("pricing uses exact nano-USD with cached input and a version", () => {
  const event = providerEvent({ ...base, usage: receipt.usage }, "production");
  assert.equal(event.estimated_cost_nanousd, 1_800_000);
  assert.equal(event.pricing_version, PRICING_VERSION);
  assert.equal(event.latency_ms, 13);
  assert.equal(event.environment, "production");
});
for (const usage of [undefined, {}, { input_tokens: 1000, output_tokens: 50 },
  { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 2 } },
  { input_tokens: -1, output_tokens: 50 }, { input_tokens: 1.2, output_tokens: 50 }]) {
  test(`unknown or invalid usage stays null: ${JSON.stringify(usage)}`, () => {
    assert.equal(providerEvent({ ...base, usage }).estimated_cost_nanousd, null);
  });
}
test("zero usage is distinct from unknown; unknown model has no price", () => {
  const usage = { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0 } };
  assert.equal(providerEvent({ ...base, usage }).estimated_cost_nanousd, 0);
  assert.equal(providerEvent({ ...base, usage, model: "unpriced-model" }).estimated_cost_nanousd, null);
});
test("one cached token preserves fractional micro-USD precision", () => {
  assert.equal(providerEvent({ ...base, usage: { input_tokens: 1, output_tokens: 0, input_tokens_details: { cached_tokens: 1 } } }).estimated_cost_nanousd, 500);
});
test("environment comes from server configuration and never defaults to production", () => {
  assert.equal(providerEvent(base, "preview").environment, "preview");
  assert.equal(providerEvent(base, "unrecognized").environment, "unknown");
});
test("real wrapper captures once; replay dispatches and records nothing new", async () => {
  rows.clear(); let calls = 0;
  const c = context();
  const client = { responses: { create: async () => { calls++; return receipt; } } };
  const result = await providerContext.run(c, () => aiResponse(client, { model: "gpt-4.1", input: "SENSITIVE PROMPT" }, "analysis"));
  assert.equal(result, receipt); assert.equal(calls, 1); assert.equal(rows.size, 1);
  const event = [...rows.values()][0];
  assert.equal(event.provider_response_id, receipt.id);
  assert.equal(event.model, receipt.model); assert.equal(event.input_tokens, 1000);
  assert.equal(event.investigation_id, c.telemetry.investigation_id);
  assert.ok(event.latency_ms >= 0);
  assert.equal(JSON.stringify(event).includes(receipt.output_text), false);
  assert.equal(JSON.stringify(event).includes("SENSITIVE PROMPT"), false);
  const replay = context({ op: { id: base.operationId, owner: "fence", steps: { "response:0": receipt } } });
  await providerContext.run(replay, () => aiResponse(client, { model: "gpt-4.1", input: "" }, "analysis"));
  assert.equal(calls, 1); assert.equal(rows.size, 1);
});
test("three-job comparison records three independent call slots", async () => {
  rows.clear(); let calls = 0;
  const client = { responses: { create: async () => ({ ...receipt, id: `resp_${calls++}` }) } };
  await providerContext.run(context(), async () => {
    for (let i = 0; i < 3; i++) await aiResponse(client, { model: "gpt-4.1", input: "synthetic" }, "compare");
  });
  assert.equal(rows.size, 3); assert.deepEqual([...rows.values()].map(row => row.call_index), [0, 1, 2]);
  assert.equal([...rows.values()].reduce((sum, row) => sum + row.estimated_cost_nanousd, 0), 5_400_000);
});
test("telemetry write failure cannot change provider success or settlement", async () => {
  writeFailure = true; const steps: string[] = [];
  try {
    const result = await providerContext.run(context({ step: async (action: string) => { steps.push(action); } }),
      () => aiResponse({ responses: { create: async () => receipt } }, { model: "gpt-4.1", input: "" }, "analysis"));
    assert.equal(result, receipt); assert.deepEqual(steps, ["begin", "response"]);
  } finally { writeFailure = false; }
});
test("provider success retains cost when settlement/persistence fails", async () => {
  rows.clear();
  await assert.rejects(providerContext.run(context({ step: async (action: string) => {
    if (action === "response") throw new Error("settlement unavailable");
  } }), () => aiResponse({ responses: { create: async () => receipt } }, { model: "gpt-4.1", input: "" }, "analysis")), /settlement unavailable/);
  assert.equal([...rows.values()][0].estimated_cost_nanousd, 1_800_000);
});
test("actual persistence helper links an analysis without duplicating its measurement", async () => {
  rows.clear();
  await providerContext.run(context(), async () => {
    await aiResponse({ responses: { create: async () => receipt } }, { model: "gpt-4.1", input: "" }, "analysis");
    const saved = await persistAIRecords("analysis", {});
    assert.equal(saved.analysisId, "analysis-created");
  });
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0].analysis_id, "analysis-created");
});
test("analysis correlation failure cannot change successful persistence", async () => {
  writeFailure = true;
  try {
    const saved = await providerContext.run(context(), () => persistAIRecords("analysis", {}));
    assert.equal(saved.analysisId, "analysis-created");
  } finally { writeFailure = false; }
});
test("incomplete response records usage without declaring provider completion", async () => {
  rows.clear();
  await providerContext.run(context(), () => aiResponse({ responses: { create: async () => ({ ...receipt, status: "incomplete" }) } }, { model: "gpt-4.1", input: "" }, "analysis"));
  const row = [...rows.values()][0];
  assert.equal(row.outcome, "incomplete"); assert.equal(row.estimated_cost_nanousd, 1_800_000);
});
for (const [status, outcome] of [[429, "rejected"], [undefined, "unknown"]] as const) {
  test(`provider failure is controlled and content-free: ${outcome}`, async () => {
    rows.clear(); const c = context();
    await assert.rejects(providerContext.run(c, () => aiResponse({ responses: { create: async () => {
      throw Object.assign(new Error("PRIVATE PROVIDER DETAILS"), { status });
    } } }, { model: "gpt-4.1", input: "" }, "turn")));
    assert.equal(c.providerError, true);
    const row = [...rows.values()][0];
    assert.equal(row.outcome, outcome); assert.equal(row.estimated_cost_nanousd, null);
    assert.equal(JSON.stringify(row).includes("PRIVATE"), false);
  });
}
