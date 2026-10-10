import { GAP_CODES, SIGNAL_CODES } from "@/lib/db/taxonomy";

type AnalysisOutput = {
  signals?: Array<{ signal_code?: unknown; signal_name: string; score: unknown; rationale: string; evidence: string[]; risk_level?: unknown }>;
  gaps?: Array<{ gap_code?: unknown; gap_title: string; gap_description: string; recommended_fix: string }>;
  plan: { next_best_action: string; tasks?: Array<{ title: string; description: string; priority: unknown; task_type?: unknown }> };
};

// Preserve the route's existing normalization before transactional persistence.
export function analysisRows(output: unknown) {
  const parsed = output as AnalysisOutput;
  const taskTypes = new Set(["resume", "story", "interview_prep", "application", "networking", "strategy"]);
  const taskAliases: Record<string, string> = { branding: "strategy", positioning: "strategy", profile: "strategy", resume_edit: "resume", resume_review: "resume", cv: "resume", storytelling: "story", story_bank: "story", interview: "interview_prep", prep: "interview_prep", apply: "application", job_apply: "application", outreach: "networking", reachout: "networking" };
  const signalCodes = new Set<string>(SIGNAL_CODES);
  const gapCodes = new Set<string>(GAP_CODES);
  const clamp = (v: unknown, fallback: number) => Math.max(1, Math.min(5, Number(v) || fallback));
  return {
    signals: (parsed.signals ?? []).map((s) => {
      const code = String(s.signal_code || "").trim();
      const risk = String(s.risk_level || "").trim().toLowerCase();
      return { signal_code: signalCodes.has(code) ? code : null, signal_name: s.signal_name, score: clamp(s.score, 1), rationale: s.rationale, evidence: s.evidence, risk_level: ["low", "medium", "high"].includes(risk) ? risk : "medium" };
    }),
    gaps: (parsed.gaps ?? []).map((g, index) => {
      const code = String(g.gap_code || "").trim();
      return { gap_code: gapCodes.has(code) ? code : null, gap_title: g.gap_title, gap_description: g.gap_description, priority: clamp(index + 1, 1), recommended_fix: g.recommended_fix };
    }),
    tasks: (parsed.plan?.tasks ?? []).map((t) => {
      const type = String(t.task_type || "").trim().toLowerCase();
      return { title: t.title, description: t.description, priority: clamp(t.priority, 3), task_type: taskTypes.has(type) ? type : taskAliases[type] ?? "strategy" };
    }),
  };
}
