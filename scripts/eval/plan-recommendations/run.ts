import { mkdirSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import { generatePlanAssessment, RECOMMENDATION_MODEL } from "../../../lib/gap-investigation/evaluate-plan-recommendation";
import { AssessmentError, validateRecommendation } from "../../../lib/gap-investigation/plan-recommendation";
import { goldenCases } from "./cases";

async function main() {
  if (!process.argv.includes("--live")) throw new Error("Real provider calls require --live. This runner never connects to Supabase.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required; do not place credentials in fixtures or reports.");
  const rows: Array<Record<string, unknown>> = [];
  let providerCases = 0, providerCorrect = 0, pipelineCorrect = 0, providerBlocked = false;
  for (const scenario of goldenCases) {
    if (providerBlocked) { rows.push({ id: scenario.id, expected: scenario.expected, status: "not_run_provider_unavailable" }); continue; }
    const callsProvider = scenario.input.evidence.length > 0;
    if (callsProvider) providerCases++;
    let raw: unknown;
    try {
      raw = await generatePlanAssessment(scenario.input);
      const prediction = (raw as {outcome?: string})?.outcome;
      const expected = scenario.expected === "insufficient_grounding" ? "INSUFFICIENT_EVIDENCE" : scenario.expected;
      providerCorrect += Number(prediction === expected);
      const result = validateRecommendation(scenario.input, raw);
      const correct = result.outcome === scenario.expected;
      pipelineCorrect += Number(correct);
      rows.push({ id: scenario.id, expected: scenario.expected, correct, raw, result, review: scenario.review });
      console.log(`${scenario.id}: ${result.outcome}${correct ? "" : " (expected " + scenario.expected + ")"}`);
    } catch (error) {
      if (error instanceof AssessmentError) {
        const correct = error.code === scenario.expected;
        pipelineCorrect += Number(correct);
        rows.push({ id: scenario.id, expected: scenario.expected, actual: error.code, correct, raw, review: scenario.review });
        console.log(`${scenario.id}: ${error.code}`);
      } else {
        providerBlocked = true;
        rows.push({ id: scenario.id, status: "provider_unavailable", code: error instanceof OpenAI.APIError ? error.status : "connection_or_configuration" });
        console.log(`${scenario.id}: provider unavailable; remaining provider cases not run`);
      }
    }
  }
  const report = {
    model: RECOMMENDATION_MODEL, timestamp: new Date().toISOString(), total_cases: goldenCases.length,
    status: providerBlocked ? "incomplete_provider_unavailable" : "complete",
    pipeline_correct: pipelineCorrect, provider_cases_attempted: providerCases,
    model_classification_accuracy: providerBlocked ? null : { correct: providerCorrect, total: providerCases },
    semantic_grounding_and_duplicate_audit: "Requires manual review of successful results; schema/reference validation is not semantic proof.",
    rows,
  };
  mkdirSync("scripts/eval/reports", { recursive: true });
  writeFileSync("scripts/eval/reports/plan-recommendations.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, pipeline_correct: pipelineCorrect, total: goldenCases.length, model_classification_accuracy: report.model_classification_accuracy }));
  if (providerBlocked || pipelineCorrect !== goldenCases.length) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Evaluation failed"); process.exitCode = 1; });
