// Canonical taxonomy for signal + gap codes. Single source of truth used by:
// - the AI structured-output schema (enums)
// - the AI prompt (rubric)
// - the cross-job aggregator (canonical bucket keys)
//
// Additive-only. Do not remove codes — historical rows may carry them.

export const SIGNAL_CODES = [
  "product_strategy",
  "execution",
  "cross_functional_leadership",
  "technical_depth",
  "customer_orientation",
  "stakeholder_influence",
  "product_sense",
  "ownership",
  "platform_thinking",
  "ai_product_judgment",
] as const;

export type SignalCode = (typeof SIGNAL_CODES)[number];

export const SIGNAL_CODE_DESCRIPTIONS: Record<SignalCode, string> = {
  product_strategy:
    "Vision, positioning, roadmap trade-offs, prioritization frameworks",
  execution:
    "Shipping cadence, decision velocity, delivery under ambiguity",
  cross_functional_leadership:
    "Influence across eng, design, marketing, sales without authority",
  technical_depth:
    "Systems, APIs, data models, holds technical trade-off conversations",
  customer_orientation:
    "Direct customer contact, research, evidence-driven prioritization",
  stakeholder_influence:
    "Exec-level comms, upward alignment, cross-org negotiation",
  product_sense: "Judgment, taste, framing quality",
  ownership:
    "End-to-end accountability, initiative outside your job description",
  platform_thinking:
    "Building for other teams, API-first product design",
  ai_product_judgment:
    "Modeling choices, evals, iteration loops, AI-specific product decisions",
};

export const GAP_CODES = [
  "quantified_impact",
  "strategic_scope",
  "organizational_influence",
  "technical_depth",
  "customer_orientation",
  "product_strategy",
  "cross_functional_leadership",
  "execution_scale",
  "domain_depth",
  "ai_product_depth",
] as const;

export type GapCode = (typeof GAP_CODES)[number];

export const GAP_CODE_DESCRIPTIONS: Record<GapCode, string> = {
  quantified_impact:
    "Lack of measurable business outcomes on resume",
  strategic_scope:
    "Work at wrong altitude — too tactical for the target level",
  organizational_influence:
    "No evidence of influence outside the immediate team",
  technical_depth:
    "Not at the technical bar the target role expects",
  customer_orientation:
    "Direct customer contact and evidence-driven prioritization missing",
  product_strategy:
    "No visible strategy artifacts (memos, positioning docs, roadmap logic)",
  cross_functional_leadership:
    "Insufficient evidence of leading through influence",
  execution_scale:
    "Hasn't shipped at the target company's scale",
  domain_depth:
    "Target-domain (infra, fintech, AI, etc.) experience thin",
  ai_product_depth:
    "AI product experience missing for AI PM roles",
};

/** Rubric block for the AI prompt. */
export function signalCodeRubric(): string {
  return SIGNAL_CODES.map(
    (code) => `- ${code}: ${SIGNAL_CODE_DESCRIPTIONS[code]}`
  ).join("\n");
}

export function gapCodeRubric(): string {
  return GAP_CODES.map(
    (code) => `- ${code}: ${GAP_CODE_DESCRIPTIONS[code]}`
  ).join("\n");
}
