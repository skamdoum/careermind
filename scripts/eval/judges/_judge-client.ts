// Tiny OpenAI client wrapper for narrow qualitative judges. Judges
// use structured output with a strict JSON schema so the eval harness
// can read `.score` / `.necessary` directly without re-parsing.

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const JUDGE_MODEL = "gpt-4.1-mini";

export type JudgeUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

// Response shape — identical schema for all judges. `score` is used by
// 1-5 raters; `necessary` by the unnecessary-question binary judge;
// `grounded` by the grounding judge. Every call must populate all three
// to satisfy strict-mode schema, so unused fields are set to -1 / false.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "integer" },
    necessary: { type: "boolean" },
    grounded: { type: "boolean" },
    rationale: { type: "string" },
  },
  required: ["score", "necessary", "grounded", "rationale"],
} as const;

export type JudgeResponse = {
  score: number;
  necessary: boolean;
  grounded: boolean;
  rationale: string;
};

export async function askJudge(args: {
  systemPrompt: string;
  userPrompt: string;
  name: string;
}): Promise<{ response: JudgeResponse; usage: JudgeUsage }> {
  const response = await openai.responses.create({
    model: JUDGE_MODEL,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: args.systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: args.userPrompt }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: args.name,
        strict: true,
        schema: SCHEMA,
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as JudgeResponse;
  const u = (response as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage;
  const usage: JudgeUsage = {
    input_tokens: u?.input_tokens ?? 0,
    output_tokens: u?.output_tokens ?? 0,
    total_tokens:
      u?.total_tokens ?? (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0),
  };
  return { response: parsed, usage };
}
