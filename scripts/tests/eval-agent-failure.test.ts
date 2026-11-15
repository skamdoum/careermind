/* eslint-disable @typescript-eslint/no-explicit-any -- Mock only SDK transport, fixture upload and database boundary; real parser and scenario driver execute. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import OpenAI from "openai";
import { PilotGuard } from "../eval/pilot-guard";
import type { AgentTurnOutput } from "../../lib/gap-investigation/agent";

// No real network, keys, resume upload, model metadata calls, or database access.
globalThis.fetch = async () => { throw Error("Offline regression forbids network"); };
let payloads: unknown[] = [], calls = 0;
class OfflineOpenAI extends OpenAI {
  constructor() {
    super({ apiKey: "synthetic", maxRetries: 0, fetch: async () => {
      calls++;
      assert.ok(payloads.length, "Unexpected extra API call");
      return Response.json({ id: `synthetic-${calls}`, object: "response", status: "completed",
        model: "gpt-6-luna", usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }, output: payloads.shift() });
    } });
  }
}
const require = createRequire(import.meta.url);
const load = (Module as any)._load;
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (name === "server-only") return {};
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(name)) return { supabaseAdmin: {} };
  if (name === "openai") return OfflineOpenAI;
  if (name === "./openai-file-cache") return { uploadOrReuseResume: async () => ({ file_id: "file-synthetic" }) };
  return load.call(this, name, ...args);
};
const { runScenarioAgent } = require("../eval/invoke-agent.ts");
(Module as any)._load = load;
const scenario = require("../eval/scenarios/GI-01-strong-hidden-evidence.json");
function turn(action: AgentTurnOutput["action"] = "ask_question"): AgentTurnOutput {
  const dimension = { status: "partial" as const, notes: "Synthetic fixture" };
  return {
    action, reasoning_note: "Synthetic", next_question: "What did you personally own?", next_question_target_dimension: "ownership",
    candidate_evidence: [], dimension_coverage: { ownership: dimension, scope: dimension, complexity: dimension, outcome: dimension, target_role_fit: dimension },
    decision_state: { current_conclusion: { underlying_capability: "partial", resume_evidence: "partial", target_role_fit: "partial" }, decision_confidence: "medium", material_uncertainty: "Ownership", would_next_question_change_conclusion: action === "ask_question", hypothesis_status: "intact" },
    stop_assessment: { confident_enough: false, diminishing_returns: false, reason: "Synthetic" },
    conclusion: { underlying_capability: "partial", resume_evidence: "partial", target_role_fit: "partial", residual_gap: "Synthetic ownership uncertainty", classification: "partial_evidence", summary: "Synthetic conclusion", remaining_uncertainty: "Ownership" },
  };
}
function message(content: unknown) { return [{ type: "message", role: "assistant", status: "completed", content }]; }
function text(value: unknown) { return message([{ type: "output_text", text: JSON.stringify(value), annotations: [] }]); }
async function run(second: unknown) {
  calls = 0; payloads = [text(turn()), second];
  return runScenarioAgent({ scenario, modelOverride: "gpt-6-luna", reasoningEffort: "none", scenarioHardMax: 6 });
}

for (const [label, second] of [
  ["malformed JSON", message([{ type: "output_text", text: "{invalid", annotations: [] }])],
  ["completed refusal with empty output_text", message([{ type: "refusal", refusal: "Synthetic refusal" }])],
] as const) test(`offline hypothesis: ${label} produces two completed calls then harness_error`, async () => {
  const outcome = await run(second);
  assert.equal(calls, 2); assert.equal(outcome.stop_reason, "harness_error");
  assert.equal(outcome.turn_count, 1); assert.deepEqual(outcome.trajectory.map((t: any) => t.role), ["assistant", "user"]);
  assert.match(outcome.harness_errors.join("\n"), /Agent call failed on turn 2/);
  assert.match(outcome.harness_errors.join("\n"), /SyntaxError/);
  assert.match(outcome.harness_errors.join("\n"), /gap-investigation\/agent\.ts/);
  // Current production parser throws before returning failed-turn usage.
  assert.equal(outcome.usage_totals.input_tokens, 10);
  assert.equal(outcome.usage_totals.output_tokens, 20);
});

test("offline hypothesis: malformed SDK output envelope can also produce the same harness_error", async () => {
  const outcome = await run(message(null));
  assert.equal(calls, 2); assert.equal(outcome.stop_reason, "harness_error");
  assert.match(outcome.harness_errors.join("\n"), /not iterable/);
  assert.match(outcome.harness_errors.join("\n"), /ResponsesParser/);
});

test("valid conclusion after two completed calls ends normally", async () => {
  const outcome = await run(text(turn("stop_and_conclude")));
  assert.equal(calls, 2); assert.equal(outcome.stop_reason, "agent_stop");
  assert.deepEqual(outcome.harness_errors, []); assert.equal(outcome.usage_totals.input_tokens, 20);
});

test("valid JSON is not runtime schema validation: malformed question fails outside callAgent", async () => {
  await assert.rejects(run(text({ ...turn(), next_question: 123, next_question_target_dimension: "complexity" })), /toLowerCase/);
  assert.equal(calls, 2);
});

test("parser failures retain their stack and reach the pilot stop diagnostic", async () => {
  const outcome = await run(message([{ type: "output_text", text: "{invalid", annotations: [] }]));
  const root = mkdtempSync(join(tmpdir(), "cm-pilot-diagnostic-"));
  try {
    const g = new PilotGuard(1232); g.reportPath = join(root, "pilot-control.json");
    assert.throws(() => g.checkScenario(outcome), /SyntaxError/);
    assert.match(outcome.harness_errors.join("\n"), /agent\.ts/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "interrupted-outcome.json"), "utf8")), outcome);
    assert.match(JSON.parse(readFileSync(g.reportPath, "utf8")).stopped, /Agent call failed on turn 2/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an already-stopped transport still saves partial outcome before rethrowing", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-pilot-interrupted-"));
  try {
    const g = new PilotGuard(1232); g.reportPath = join(root, "pilot-control.json");
    assert.throws(() => g.stop("Pilot provider HTTP 400"));
    const outcome = { harness_errors: ["Synthetic SDK error"], trajectory: [{ role: "assistant", content: "Synthetic question" }] };
    assert.throws(() => g.checkScenario(outcome), /HTTP 400/);
    assert.ok(existsSync(join(root, "interrupted-outcome.json")));
    assert.deepEqual(JSON.parse(readFileSync(join(root, "interrupted-outcome.json"), "utf8")), outcome);
    assert.equal(g.stopped, "Pilot provider HTTP 400");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
