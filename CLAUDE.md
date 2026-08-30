# CLAUDE.md — CareerMind V1.0 — Stephane

@AGENTS.md
@product-context.md

## Who I Am
Senior PM at CareerMind, owning the product. Leading first delivery v1.0 to first customers.

## Product
CareerMind helps experienced PMs identify what they need to fix across multiple target jobs and gives them a prioritized action plan.

**Current focus (v1.0):** V1 polish and beta readiness. Full context in `product-context.md`.

## Preferences
- Be concise and direct. No corporate jargon.
- American English spelling.
- Dates in YYYY-MM-DD format.
- Use "CareerMind" — not "Careermind" or "Career Mind".
- Dry wit is welcome. Dad jokes are not.

## Workspace Structure
- `product-context.md` — full product and market context

<!--
- `team-context.md` — full team profiles and working styles
- `Projects/` — active project folders, each with its own CLAUDE.md
- `Knowledge/` — reference material, research, people notes
-->

---

## Operating Mode

Default mode: CONSERVATIVE.

Before code changes:

1. Explain intended scope
2. Identify touched files
3. Keep changes narrow

Do NOT:

- rewrite large files unnecessarily
- change auth/schema/routes without request
- refactor architecture proactively

Preserve:

- working APIs
- fallback behavior
- stable UX patterns

---

## Development Priorities

Priority order:

1. Product clarity
2. Stable UX
3. Correct architecture
4. Narrative quality
5. Performance
6. New features

Prefer V1 polish over feature expansion.

---

## Architecture Rules

Shared layout:

- `app/components/app-shell.tsx`
- `app/components/app-navbar.tsx`
- `app/dashboard/layout.tsx`

Authenticated pages should share:

- navbar
- width
- spacing

Preferred container:

```tsx
max-w-4xl w-full mx-auto px-6 py-6
```

Do not introduce duplicated layout patterns.

---

## API Rules

All routes return:

```ts
{
  success: boolean
  data?: any
  error?: string
}
```

Keep response shapes consistent.

---

## AI Rules

AI owns:

- narratives
- coaching language
- strategic interpretation

AI does NOT own:

- verdicts
- counts
- deterministic logic
- progress tracking

Deterministic computation first.

AI augments interpretation.

---

## Evaluation & Calibration

Operational memory for the CareerMind analysis engine (`app/api/analyze/route.ts`, `lib/db/taxonomy.ts`).

### Objective

CareerMind is a resume-screen career evaluation system. Goal: estimate whether the resume demonstrates sufficient fit for the target role and level — not to predict final hiring decisions.

Verdict vocabulary: **Strong Hire | Borderline | Below Bar**.

### V1 findings (calibration test suite completed)

Recurring V1 failure modes observed across strong controls, obvious mismatches, Senior→Principal altitude stretches, domain-transition candidates, technically strong candidates lacking PM ownership, strong Principal leaders lacking target technical/domain depth, and near-direct JD/resume matches:

1. Adjacent/supporting experience inflated into direct ownership.
2. Gaps manufactured despite explicit positive counter-evidence.
3. Secondary gaps outrank fundamental/gating requirements.
4. Missing resume evidence stated as absence of candidate capability.
5. Senior vs Principal altitude not calibrated consistently.
6. Strong candidates rated too harshly despite directly satisfying JD.
7. Obvious mismatches rated too generously via transferable-strengths compensation.
8. Signal scores and verdict internally inconsistent.
9. Model invents unsupported resume specifics.
10. Related symptoms split into redundant gaps, inflating gap count.

### Product principles learned

Two gap types the system must distinguish:

- **CAPABILITY GAP** — positive evidence that the candidate does not meet an important requirement.
- **EVIDENCE GAP** — the resume does not provide enough evidence to establish whether the candidate has the capability.

Absence of resume evidence is not automatically evidence of capability absence.

Adjacent experience ≠ ownership. Concrete distinctions:

- Product Marketing ≠ Product Management
- Supporting PMs ≠ owning product strategy
- Supporting launches ≠ product ownership
- Working with engineering ≠ leading product execution
- SaaS experience ≠ platform/API experience
- Presenting to executives ≠ influencing executive decisions

Additional rules:

- Strong positive evidence must protect against false gaps.
- Zero material gaps is a valid outcome.
- Gating requirements must be identified and prioritized before generic strengths.
- Target-level altitude must be assessed separately from execution quality.
- Principal-level evidence generally requires broader strategic/organizational scope than excellent Senior-level execution.

### Architecture finding (V1 audit)

The current implementation gives the LLM ownership of: `core_verdict`, signal scores, gaps, positioning summary, plan/guidance.

There is currently **no deterministic verdict calculation**. Signal scores do not deterministically drive `core_verdict`.

This conflicts with the AI Rules section above (deterministic logic should own verdicts/counts). Deliberate decision: fix in **V2.2** after V2.1's prompt/evidence improvements are measured.

### V2 strategy — three stages

- **V2.1** — Prompt + structured evidence reasoning improvements. Verdict remains AI-generated. **Shipped and measured** — 11/12 verdicts matched the independent evaluation on the frozen suite.
- **V2.2** — Narrow prompt-calibration update on top of V2.1. Same AI-owned verdict. Addresses two residual failure modes: thin-evidence inflation and false-gap generation despite positive evidence. **No deterministic verdict in this stage.**
- **V2.3 (still deferred)** — Only if V2.2 measurement still shows verdict calibration is unstable, introduce deterministic verdict logic driven by structured requirement assessments.

Do not skip V2.1 or V2.2.

### V2.1 scope

1. Role/gating requirement identification.
2. Evidence hierarchy: `direct | supporting | adjacent | none`.
3. Strict grounding to the current resume (no invented specifics).
4. Explicit evidence-gap vs capability-gap reasoning.
5. Counter-evidence check before creating any gap.
6. Explicit permission for zero gaps.
7. Senior vs Principal altitude guidance.
8. Explicit Strong Hire / Borderline / Below Bar definitions.
9. Target-role-relative signal scoring (4/5 requires direct evidence, not adjacent).
10. Gap prioritization (gating first, presentation last).
11. Stronger resume-source isolation.

Structured output adds `role_requirements[]` inside `analyses.raw_json` (no DB schema change):

```ts
{
  requirement: string,
  importance: "gating" | "high" | "medium",
  evidence_level: "direct" | "supporting" | "adjacent" | "none",
  evidence: string[],
  assessment: "met" | "partial" | "not_met"
}
```

### Resume-source isolation

V1 could send both `resumeText` and `latestResume.file_path` to the model in the same request — footgun for stale-text contamination.

V2.1 behavior: uploaded/persisted resume file is the canonical source when available; `resumeText` used only as fallback when no file is loaded. Never both.

### Current implementation status (as of 2026-08-23)

All 11 V2.1 scope items implemented in `app/api/analyze/route.ts`. **Uncommitted** — single working-tree diff at end of session.

Verified in code:

- New system prompt with sections: GROUNDING (STRICT), EVIDENCE HIERARCHY, ABSENCE OF EVIDENCE ≠ ABSENCE OF CAPABILITY, COUNTER-EVIDENCE CHECK, ALTITUDE CALIBRATION, verdict definitions, signal score scale, gap prioritization.
- Schema adds top-level `role_requirements[]` under `strict: true`, added to top-level `required`.
- Resume assembly uses `resumeContentParts.length === 0` guard so file and text are mutually exclusive.
- `TODO(v2.2)` comment placed near `core_verdict` handling flagging the deferred deterministic-verdict layer.

Not implemented (intentional):

- Deterministic verdict layer (now V2.3 — deferred until after V2.2 measurement).
- DB column for `role_requirements` (stays in `raw_json`).
- UI rendering of `role_requirements` (downstream, will improve passively as `raw_json` improves).

Build + TypeScript: passed at end of session. No known regressions.

### V2.2 scope (calibration only, no deterministic verdict)

Applied on top of V2.1 after the regression suite was rerun. 11/12 verdicts already matched the independent evaluation; V2.2 targets the two remaining calibration failure modes without weakening any V2.1 behavior.

Failure modes addressed:

- **Thin-evidence inflation** — the evaluator sometimes treated evidence that an activity OCCURRED as evidence of STRONG PERFORMANCE at the target level. Correct handling requires distinguishing evidence EXISTENCE from evidence STRENGTH.
- **False-gap generation despite positive evidence** — the evaluator produced "could be even stronger" gaps for candidates whose resumes already contained meaningful direct evidence in the same area.

Prompt changes (all in `app/api/analyze/route.ts`; no schema, API, or frontend changes):

1. **Evidence Strength Test** — new prompt section introducing the Ownership / Scope / Complexity / Outcome reasoning lens. Explicitly states "evidence TYPE and evidence STRENGTH are separate concepts" so `direct | supporting | adjacent | none` is preserved and NOT redefined.
2. **Thin Evidence Rule** — enumerates the risky verbs (owned, led, responsible for, worked with, supported, presented to, managed, drove) and instructs that their mere presence must not be treated as strong evidence. A thin statement can still be DIRECT — DIRECT ≠ STRONG.
3. **Stronger signal-score anchors** — the 1–5 scale is expanded so each tier references scope/ownership/complexity/outcome, with an explicit "prestigious title, years of experience, or strong verbs alone must NOT independently justify a 4 or 5."
4. **Strong Hire evidence threshold** — the Strong Hire clause now requires (a) gating met, (b) strong evidence across most high-priority requirements, (c) target scope/altitude demonstrated, (d) no material uncertainty in critical areas. Adds "broad keyword or activity coverage is NOT enough for Strong Hire — prefer Borderline if multiple important requirements are supported only by thin/generic evidence." Guardrail retained: Strong Hire must remain reachable — no requirement for perfection or zero gaps.
5. **Gap Counter-Evidence Test (5 steps)** — replaces the V2.1 3-step check. Requires stating the requirement internally, searching for contradictory evidence, evaluating at the target-role level (using the Evidence Strength Test), suppressing if satisfied, describing actual uncertainty if partial. Adds an explicit "not-a-gap" list (metric could be more specific / bullet could be better / another example would strengthen / could show greater scope / evidence not perfect) and states that resume-optimization opportunities belong in coaching, not `gaps`.
6. **Quantified-Impact Calibration** — outcome evidence explicitly includes adoption, usage, reliability, efficiency, and credible qualitative organizational change — not only revenue/ARR/percentages. A "quantified impact" gap is only legitimate when the JD explicitly requires measurable outcomes AND the resume only says "helped improve / contributed to / supported" without magnitude or ownership.

Preserved from V2.1 unchanged: `GROUNDING (STRICT)`, `EVIDENCE HIERARCHY` (direct/supporting/adjacent/none), `ABSENCE OF EVIDENCE ≠ ABSENCE OF CAPABILITY`, `ALTITUDE CALIBRATION (SENIOR vs. PRINCIPAL)`, the schema, the API contract, the resume identity resolution, and the frontend flow.

Explicitly NOT in V2.2:

- No deterministic verdict layer — `core_verdict` is still AI-generated. Per the AI Rules, deterministic ownership of verdicts stays deferred to V2.3, contingent on V2.2 measurement.
- No numerical weighting formula.
- No schema, API, or frontend changes.
- No candidate-specific tuning — the prompt contains no test-case names.

### Regression strategy

After V2.1 lands, rerun the **exact same** V1 evaluation test suite (unchanged test cases).

Compare V1 vs V2.1 using:

- Independent Verdict vs CareerMind Verdict, Direction, Calibration Error
- Evidence Accuracy /5
- Gap Validity /5
- Gap Count
- Internal Consistency
- Capability Gaps vs Evidence Gaps split
- Unsupported / Overweighted Gaps

Success = improvements in verdict calibration, evidence grounding, false-gap rate, gap validity, level discrimination, gating-requirement handling, and internal consistency.

Decision rule (post-V2.2 rerun):

- Thin-evidence inflation drops AND false-gap generation drops AND V2.1's 11/12 verdict match holds or improves → V2.2 ships; V2.3 (deterministic verdict) remains deferred.
- One failure mode improves but the other regresses → prompt-tune inside V2.2 before moving on.
- Verdict calibration regresses vs V2.1 → roll back to V2.1 and revisit before V2.3.

## Next Session

V2.2 is implemented in code (prompt-only) but uncommitted. Recommended first steps in order:

1. Review the uncommitted diff in `app/api/analyze/route.ts` for any final tweaks before commit.
2. Rerun the frozen V1/V2.1 regression suite against V2.2 (unchanged test cases).
3. Compare V2.1 vs V2.2 on the same metrics listed under Regression strategy, plus:
   - Thin-evidence inflation rate (Strong Hire on materially thin evidence).
   - False-gap rate on positive-control candidates who already satisfy the requirement.
4. Only after V2.2 results are analyzed: decide whether V2.3 deterministic verdict is still needed.

Do NOT add new test cases before rerunning the existing suite.
Do NOT advance to V2.3 (deterministic verdict) before V2.2 results are evaluated.

---

## Narrative UX Rules

Avoid:

fallback → delayed AI replacement

Prefer:

- cached instant render
- delayed skeleton (>300ms)
- fallback only after failure

---

## Testing

After meaningful changes:

```bash
npm run dev
```

Verify:

- layout consistency
- no duplicate navbars
- API validity
- fallback behavior
- responsive behavior

---

## Commit Style

Example:

```bash
git add app/components/example.tsx lib/utils.ts

git commit -m "feat(ui): improve narrative loading UX"
```