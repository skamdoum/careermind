/* eslint-disable @typescript-eslint/no-explicit-any -- Only the SDK boundary is mocked; real request builders and structured-output helpers run. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { AgentTurnInput } from "../../lib/gap-investigation/agent";

const require = createRequire(import.meta.url);
delete process.env.OPENAI_GENERATION_MODEL;
delete process.env.OPENAI_JUDGE_MODEL;
let request: any;
const output = { score: 4, necessary: true, grounded: true, rationale: "Synthetic fixture" };
const original = (Module as any)._load;
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (name === "server-only") return {};
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(name)) return { supabaseAdmin: {} };
  if (name === "openai") return class {
    responses = { create: async (params: any) => {
      request = params;
      return { model: params.model, output_text: JSON.stringify(output), usage: { input_tokens: 10, output_tokens: 20 } };
    } };
  };
  return original.call(this, name, ...args);
};
const { GENERATION_MODEL, EVALUATION_JUDGE_MODEL, responseModelSettings } = require("../../lib/openai/models.ts");
const { runAgentTurnFull } = require("../../lib/gap-investigation/agent.ts");
const { generatePlanAssessment } = require("../../lib/gap-investigation/evaluate-plan-recommendation.ts");
const { askJudge } = require("../eval/judges/_judge-client.ts");
const { goldenCases } = require("../eval/plan-recommendations/cases.ts");
(Module as any)._load = original;

const input: AgentTurnInput = {
  context: { gap: { gap_title: "Scope", gap_code: null, gap_description: "Fixture gap", recommended_fix: null, severity: null }, target: { role: "PM", level: "Senior" },
    analysis: { id: "fixture", positioning_summary: null, related_signals: [] }, resume: { id: null, file_name: null } },
  transcript: [], evidence: [], turn_count: 0, openai_resume_file_id: null,
  is_kickoff: true, prior_dimension_coverage: null, prior_decision_state: null,
};

test("production and judge default independently to Luna with explicit none", () => {
  assert.equal(GENERATION_MODEL, "gpt-6-luna");
  assert.equal(EVALUATION_JUDGE_MODEL, "gpt-6-luna");
  assert.deepEqual(responseModelSettings(), { model: "gpt-6-luna", reasoning: { effort: "none" } });
  assert.deepEqual(responseModelSettings("gpt-6-sol"), { model: "gpt-6-sol", reasoning: { effort: "none" } });
  assert.throws(() => responseModelSettings("gpt-6-astra"), /Unsupported GPT-6/);
});

test("independent environment overrides preserve historical comparisons", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", `
    const assert = require('node:assert/strict');
    const config = require('./lib/openai/models.ts');
    assert.equal(config.GENERATION_MODEL, 'gpt-6-sol');
    assert.equal(config.EVALUATION_JUDGE_MODEL, 'gpt-4.1-mini');
    assert.deepEqual(config.responseModelSettings(config.EVALUATION_JUDGE_MODEL), {model:'gpt-4.1-mini'});
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name, ...args) {
      if (name === 'openai') return class {
        responses = { create: async (request) => {
          assert.equal(request.model, 'gpt-4.1-mini');
          assert.equal(Object.hasOwn(request, 'reasoning'), false);
          assert.equal(request.text.format.strict, true);
          return {output_text:'{}'};
        } };
      };
      return load.call(this, name, ...args);
    };
    require('./scripts/eval/judges/_judge-client.ts').askJudge({systemPrompt:'Fixture', userPrompt:'Fixture', name:'fixture'})
      .catch(error => { console.error(error); process.exitCode = 1; });
  `], { env: { ...process.env, OPENAI_GENERATION_MODEL: "gpt-6-sol", OPENAI_JUDGE_MODEL: "gpt-4.1-mini" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

for (const [model, effort, expected] of [
  ["gpt-6-luna", undefined, "none"], ["gpt-6-sol", "low", "low"],
  ["gpt-6-luna", "none", "none"], ["gpt-4.1", undefined, undefined],
  ["gpt-4.1-2025-04-14", undefined, undefined], ["o4-mini", "high", "high"],
] as const) test(`agent request: ${model}, effort=${effort}`, async () => {
  const result = await runAgentTurnFull({ ...input, model_override: model, reasoning_effort: effort }, { unmeteredEvaluation: true });
  assert.equal(request.model, model);
  assert.deepEqual(request.reasoning, expected ? { effort: expected } : undefined);
  assert.equal(request.max_output_tokens, 4096);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.ok(request.text.format.schema.required.includes("conclusion"));
  assert.equal(result.model, model);
  assert.deepEqual(result.output, output);
});

test("Luna plan assessment retains strict Zod output and bounds without temperature", async () => {
  assert.deepEqual(await generatePlanAssessment(goldenCases[0].input, { unmeteredEvaluation: true }), output);
  assert.equal(request.model, "gpt-6-luna");
  assert.deepEqual(request.reasoning, { effort: "none" });
  assert.equal(Object.hasOwn(request, "temperature"), false);
  assert.equal(request.max_output_tokens, 2400);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.ok(request.text.format.schema.required.includes("assessed_dimensions"));
});

test("judge uses Luna none and retains its structured result contract", async () => {
  const result = await askJudge({ systemPrompt: "Fixture system", userPrompt: "Fixture user", name: "fixture_judge" });
  assert.equal(request.model, "gpt-6-luna");
  assert.deepEqual(request.reasoning, { effort: "none" });
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema.required, ["score", "necessary", "grounded", "rationale"]);
  assert.deepEqual(result.response, output);
});
