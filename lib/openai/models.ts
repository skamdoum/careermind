// Server-side defaults. Override independently for rollback or evaluation comparisons.
export const GENERATION_MODEL = process.env.OPENAI_GENERATION_MODEL?.trim() || "gpt-6-luna";
export const EVALUATION_JUDGE_MODEL = process.env.OPENAI_JUDGE_MODEL?.trim() || "gpt-6-luna";

export type ReasoningEffort = "none" | "low" | "medium" | "high";

// Keep legacy GPT-4 requests free of reasoning parameters. Luna/Sol otherwise
// default to medium at the provider, so explicitly disable reasoning here.
export function responseModelSettings(model = GENERATION_MODEL, effort?: ReasoningEffort): {
  model: string;
  reasoning?: { effort: ReasoningEffort };
} {
  if (/^gpt-6-(luna|sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
    return { model, reasoning: { effort: effort ?? "none" } };
  }
  if (/^gpt-6/.test(model)) {
    throw new Error(`Unsupported GPT-6 model configuration: ${model}. Use gpt-6-luna or gpt-6-sol.`);
  }
  if (/^o\d/.test(model) && effort && effort !== "none") {
    return { model, reasoning: { effort } };
  }
  return { model };
}
