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

### V2 strategy — four stages

- **V2.1** — Prompt + structured evidence reasoning improvements. Verdict remains AI-generated. **Shipped and measured** — 11/12 verdicts matched the independent evaluation on the frozen suite.
- **V2.2** — Narrow prompt-calibration update on top of V2.1. Same AI-owned verdict. Addressed two residual failure modes: thin-evidence inflation and false-gap generation despite positive evidence. **Shipped and measured** — 11/12 exact verdict agreement on the frozen 12-case calibration suite, 0 false Strong Hires, 0 false Below Bars, 1 overly conservative verdict (CAL-01 Alex Morgan → Senior PM Platform expected Strong Hire, returned Borderline). No deterministic verdict in this stage.
- **V2.3** — Narrow prompt-calibration update on top of V2.2 addressing three specific issues: Senior-vs-Principal altitude leakage, gaps not grounded in the actual target JD, redundant/overlapping gaps. Same AI-owned verdict. **Shipped and measured** — 10/12 exact verdict agreement on the frozen 12-case calibration suite. Fixed CAL-01 Senior harshness. Regressed CAL-02 and CAL-09 to Strong Hire despite the positioning summary itself concluding Principal-level altitude was not established — Principal altitude under-enforced.
- **V2.3.1** — Narrow prompt-calibration update on top of V2.3 addressing the single V2.3 regression: Principal-target Strong Hire being returned despite the reasoning identifying insufficient Principal-level altitude. Same AI-owned verdict. **Measured on a 5-case validation gate** — 3/5 verdicts matched (CAL-01 Senior preserved, CAL-09 Rachel Principal lifted correctly to Borderline, CAL-11 Priya Principal preserved as Strong Hire). Remaining failures: CAL-02 Alex Principal still returned Strong Hire despite hedged Principal-weakness prose (assessment-vs-signal internal contradiction), CAL-10 Morgan Principal Technical returned Strong Hire with target-frame drift ("Strong Hire for a Senior PM role" while target was Principal Technical) despite partial technical-depth requirement and 3/5 technical_depth signal. Also observed on CAL-01: gap emitted that contradicted its own "met" requirement. Diagnosis: the failures are not narrow altitude misses — they are a general cross-stage coherence gap where a material weakness identified in one field is not required to propagate to gaps or the verdict, plus the absence of a target-role anchoring rule. Stopped the regression at the 5-case gate rather than running the full frozen suite.
- **V2.3.2** — Narrow prompt-calibration update on top of V2.3.1 addressing the general cross-stage coherence defect surfaced by the V2.3.1 gate, plus target-role frame drift. Same AI-owned verdict. **Measured on the 5-case validation gate** — 4/5 verdicts matched. CAL-01 preserved (Strong Hire, partial exec-influence gap coexisting), CAL-02 lifted correctly to Borderline with a clean type-vs-strength distinction, CAL-09 stayed Borderline, CAL-11 stayed Strong Hire with gaps []. Remaining failures: (a) CAL-10 Morgan Principal Technical — returned Strong Hire despite technical-depth requirements assessed partial, `technical_depth = 3/5`, a valid technical-depth gap, and positioning_summary explicitly stating "moderate uncertainty about your fit for a highly technical Principal PM role"; positioning_summary also drifted to "for a Senior-level PM role in enterprise SaaS or business process automation, you are a strong hire." (b) CAL-11 Priya — substantively correct (Strong Hire, gaps []) but positioning_summary opened calling the Principal target a "Senior-level Developer Platform PM role." Two remaining defects diagnosed: target-role frame drift (three prohibition-style anchors did not enforce a positive structural rule) and verdict decoupling from identified material weakness ("no material hiring uncertainty in critical areas" plus "let it affect core_verdict as appropriate" both too vague at the last stage). Stopped the regression at the 5-case gate.
- **V2.3.3** — Narrow prompt-calibration update on top of V2.3.2 addressing the two remaining defects: exact target-role identity preservation (positive structural anchor in positioning_summary) and Strong Hire compatibility with material unresolved hiring concerns (rule tightening in STRONG HIRE and in FINAL CONSISTENCY CHECK step 1 YES branch). Same AI-owned verdict. Borderline vs Below Bar remains AI judgment governed by existing verdict definitions.
- **V2.4 (still deferred)** — Only if V2.3.3 measurement still shows verdict calibration is unstable, introduce deterministic verdict logic driven by structured requirement assessments.

Do not skip V2.1, V2.2, V2.3, V2.3.1, V2.3.2, or V2.3.3.

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

- No deterministic verdict layer — `core_verdict` is still AI-generated. Per the AI Rules, deterministic ownership of verdicts stays deferred, contingent on V2.2 measurement.
- No numerical weighting formula.
- No schema, API, or frontend changes.
- No candidate-specific tuning — the prompt contains no test-case names.

### V2.3 scope (calibration only, no deterministic verdict)

Applied on top of V2.2 after the frozen 12-case calibration suite was rerun. V2.2 baseline: 11/12 exact verdict agreement, 0 false Strong Hires, 0 false Below Bars, 1 overly conservative verdict. V2.3 targets three specific failure modes without weakening any V2.1 or V2.2 behavior.

Failure modes addressed:

- **Principal-altitude leakage into Senior evaluation** — a strong Senior candidate was downgraded because the resume lacked Principal-level executive/organizational altitude, even though the target JD was Senior (CAL-01 pattern). Senior Strong Hire must not require executive/C-suite influence, cross-org multi-year strategy, or ecosystem-scale investment leverage unless the JD explicitly asks for them.
- **Gaps not grounded in the actual target JD** — the evaluator generated an "AI Product Ownership Absent" gap because AI is often expected in similar roles, not because the actual JD required it. Gaps must be grounded in this specific JD, not in generalized market expectations for similar roles.
- **Redundant/overlapping gaps** — outputs sometimes contained multiple valid gaps that described the same underlying missing capability (e.g. "no product strategy/roadmap ownership" + "no platform vision/multi-year roadmap"). These reduce clarity even when individually correct.

Prompt changes (all in `app/api/analyze/route.ts`; no schema, API, frontend, database, or gap-priority-normalization changes):

1. **Senior Strong Hire — required vs. NOT required** — new subsection inside the existing ALTITUDE CALIBRATION block. Lists the Senior-appropriate criteria that CAN justify Strong Hire, and the Principal-scoped criteria that MUST NOT be required unless the JD explicitly asks. Adds two calibration rules: "Do not downgrade a strong Senior candidate merely because the resume lacks Principal-level organizational or executive altitude" and "Evaluate executive influence RELATIVE TO the target level." The existing "Excellent Senior-level execution does NOT automatically establish Principal-level altitude" sentence is preserved — that protects the Principal cases V2.2 already gets right.
2. **JD-Grounding Test** — new subsection inside the GAP COUNTER-EVIDENCE TEST section. Three-question test: (1) what specific requirement in THIS JD makes this gap materially relevant, (2) is that requirement explicit in the JD or a direct reasonable inference, (3) would a hiring decision for THIS role materially depend on this missing evidence. Explicit prohibited-justification list: "this is often expected in similar roles" / "many Principal PMs have..." / "the industry increasingly values..." / etc. Non-required desirable skills belong in coaching, not gaps.
3. **Semantic Overlap Pass** — new subsection inside the CRITICAL GAPS block. Four-question merge test per pair: same underlying missing capability, would closing one substantially close the other, same hiring consequence, would a hiring manager describe them as one concern. Target 0–4 distinct material gaps; fewer is better when the evidence supports consolidation. Guardrail: "do not hide genuinely distinct issues merely to reduce count — merging is a clarity tool, not a hiding tool."

Preserved from V2.1/V2.2 unchanged: GROUNDING (STRICT), EVIDENCE HIERARCHY (direct/supporting/adjacent/none), Evidence Type vs Strength distinction, Ownership/Scope/Complexity/Outcome test, Thin Evidence Rule, ABSENCE OF EVIDENCE ≠ ABSENCE OF CAPABILITY, capability-vs-evidence-gap distinction, positive evidence protection, zero-gap permission, quantified-impact calibration, target-role-relative signal scoring, Senior-vs-Principal altitude framework (Principal side), Strong Hire / Borderline / Below Bar definitions, role_requirements extraction, signal scoring anchors, the schema, the API contract, resume identity resolution, gap priority normalization (server-side arrayIndex+1), and the frontend flow.

Explicitly NOT in V2.3:

- No deterministic verdict layer — `core_verdict` is still AI-generated. Deterministic ownership of verdicts stays deferred to V2.4, contingent on V2.3 measurement.
- No numerical weighting formula.
- No schema, API, database, or frontend changes.
- No source_requirement_id DB field.
- No candidate-specific tuning — the prompt contains no test-case names, no "Alex", "Morgan", "Jordan", "Maya", "Priya", "Rachel", "Jamie", "Daniel", "Taylor", "Chris" references.

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

- Thin-evidence inflation drops AND false-gap generation drops AND V2.1's 11/12 verdict match holds or improves → V2.2 ships; deterministic verdict remains deferred.
- One failure mode improves but the other regresses → prompt-tune inside V2.2 before moving on.
- Verdict calibration regresses vs V2.1 → roll back to V2.1 and revisit before advancing.

Decision rule (post-V2.3 rerun on the same frozen 12-case suite):

- 12/12 exact verdict agreement AND CAL-01 Alex Senior lifts to Strong Hire without regressing any of the 11 other cases AND no invented JD-ungrounded gaps AND redundant-gap count drops → V2.3 ships; deterministic verdict remains deferred to V2.4.
- CAL-01 lifts but any preserved case regresses (Alex Principal, Alex AI, Jordan, Maya, Chris, Taylor, Daniel, Rachel, Morgan, Priya, Jamie) → prompt-tune inside V2.3 before moving on. Do NOT tune to named cases.
- Verdict calibration regresses vs V2.2 overall → roll back to V2.2 and revisit before V2.4.

### V2.3.1 scope (calibration only, no deterministic verdict)

Applied on top of V2.3 after the frozen 12-case calibration suite was rerun. V2.3 baseline: 10/12 exact verdict agreement. V2.3 fixed CAL-01 Senior harshness and improved JD-grounding + gap deduplication (do not revert), but regressed CAL-02 and CAL-09 — both Principal targets — to Strong Hire despite the positioning summary itself stating Principal-level scope was not established. V2.3.1 targets that single Principal-under-enforcement failure without weakening any V2.1/V2.2/V2.3 behavior.

Failure mode addressed:

- **Principal-altitude under-enforcement** — for Principal targets, strong Senior-level functional execution (roadmap, prioritization, cross-functional leadership, discovery, outcomes) is being treated as sufficient for Strong Hire even when the reasoning itself identifies missing Principal-altitude evidence. The altitude conclusion in the positioning_summary is not propagating to role_requirements, signal scores, gaps, or core_verdict. The symptom is the specific contradiction "strong Senior but Principal-level scope not established" + core_verdict = Strong Hire + gaps = []. This is NOT general Principal inflation — CAL-10 and CAL-11 continue to be evaluated correctly. It is a target-relative enforcement gap on the Principal side that V2.3's Senior-side additions did not have a mirror for.

Prompt changes (all in `app/api/analyze/route.ts`; no schema, API, frontend, database, or gap-priority-normalization changes):

1. **PRINCIPAL STRONG HIRE — required vs. NOT required** — new subsection inside the existing ALTITUDE CALIBRATION block, symmetric to the existing SENIOR STRONG HIRE subsection. Lists Principal-altitude evidence dimensions the target JD may call for (multi-year strategic direction, platform/product-line/portfolio scope, cross-organizational influence, strategy adopted beyond the immediate team, major investment or strategic-tradeoff influence, executive influence over material product/platform decisions, ecosystem-level effects, organizational leverage / mentorship across other PMs). Explicitly states these are JD-relative — not a checklist — and that the Principal bar must not be broadly raised beyond what the target JD actually asks for. Adds the rule: "Strong Senior-level functional excellence is necessary but NOT sufficient for a Principal Strong Hire. If Senior-level competencies are strong but the JD's Principal-level altitude dimensions are not established by direct evidence, prefer Borderline."
2. **PRINCIPAL ALTITUDE CONSISTENCY CHECK** — new subsection immediately after the Principal Strong Hire block. Explicit final consistency clause for Principal targets: (a) if reasoning concludes demonstrated scope is primarily Senior-level, do NOT return Strong Hire for a Principal target unless other direct evidence establishes the required Principal altitude; (b) a material Principal-altitude requirement with insufficient evidence must be reflected in role_requirements (importance + assessment), calibrated in relevant target-relative signal scores, and — when material — surfaced as a gap; (c) explicitly forbids the "strong at Senior but Principal scope not established" positioning + Strong Hire + gaps [] contradiction. Ends with an explicit scoping clause: "This consistency check applies ONLY to Principal targets. Senior targets continue to be evaluated under the SENIOR STRONG HIRE rules above and must not be penalized for lacking Principal-level altitude."

Preserved from V2.1/V2.2/V2.3 unchanged: GROUNDING (STRICT), EVIDENCE HIERARCHY (direct/supporting/adjacent/none), Evidence Type vs Strength distinction, Ownership/Scope/Complexity/Outcome test, Thin Evidence Rule, ABSENCE OF EVIDENCE ≠ ABSENCE OF CAPABILITY, capability-vs-evidence-gap distinction, positive evidence protection, zero-gap permission, JD-Grounding Test, Semantic Overlap Pass, quantified-impact calibration, target-role-relative signal scoring, SENIOR STRONG HIRE — required vs. NOT required subsection (Senior side untouched), the schema, the API contract, resume identity resolution, gap priority normalization (server-side arrayIndex+1), and the frontend flow.

Explicitly NOT in V2.3.1:

- No deterministic verdict layer — `core_verdict` is still AI-generated. V2.4 remains deferred, contingent on V2.3.1 measurement.
- No numerical weighting formula.
- No schema, API, database, or frontend changes.
- No new Principal-side gating requirements. Principal altitude remains JD-relative.
- No candidate-specific tuning — the prompt contains no test-case names, no "Alex", "Morgan", "Jordan", "Maya", "Priya", "Rachel", "Jamie", "Daniel", "Taylor", "Chris" references.
- No changes to Senior-side calibration. The V2.3 Senior fix (CAL-01 lift) must be preserved.

Decision rule (post-V2.3.1 rerun on the same frozen 12-case suite):

- 12/12 exact verdict agreement AND CAL-02 + CAL-09 lift from Strong Hire to Borderline AND CAL-01 stays Strong Hire AND CAL-11 stays Strong Hire (gaps allowed empty) AND CAL-10 stays Borderline → V2.3.1 ships; V2.4 remains deferred.
- CAL-02 / CAL-09 lift but CAL-01 regresses back to Borderline or CAL-11 regresses off Strong Hire → prompt-tune inside V2.3.1 before advancing. Do NOT tune to named cases.
- Verdict calibration regresses vs V2.3 overall → roll back to V2.3 and revisit before V2.4.

### V2.3.2 scope (calibration + coherence only, no deterministic verdict)

Applied on top of V2.3.1 after the 5-case validation gate showed 3/5 agreement, with CAL-02 and CAL-10 both failing for reasons that are not narrow calibration misses. V2.3.2 addresses the general cross-stage coherence gap and target-role frame drift diagnosed after that gate.

Failure modes addressed:

- **Assessment-vs-evidence-strength decoupling** (CAL-02) — the model recognized thin/indirect Principal-level evidence in the signal rationale, but still coded the underlying role_requirement as `direct/met` because the ROLE REQUIREMENTS block only required evidence TYPE, not evidence STRENGTH. Downstream, the requirement being `met` suppressed the gap and drove Strong Hire. The V2.2 EVIDENCE STRENGTH TEST was documented against signals, not against requirement assessments.
- **Material-weakness → gap-and-verdict propagation gap** (CAL-10) — the model correctly assessed the technical requirement as `supporting/partial` and scored `technical_depth = 3/5` with an explicit "direct ownership not explicit" rationale, but still produced `gaps: []` and Strong Hire. The GAP COUNTER-EVIDENCE TEST allowed general candidate strengths to be read as counter-evidence to a specific requirement gap, and there was no rule requiring a material weakness identified in signal rationales to appear in gaps or affect core_verdict.
- **Target-role frame drift** (CAL-10) — positioning_summary said "Strong Hire for a Senior PM role targeting enterprise or platform business applications" while the actual target was Principal Technical PM. Nothing in the prompt forbade the model from substituting a lower/different role as the frame of evaluation.
- **Gap-vs-requirement inconsistency** (CAL-01 warning) — a gap was emitted ("Thin evidence of executive-level influence") for a requirement that was coded `high, supporting/met`. The CRITICAL GAPS block did not require gaps to correspond to a non-met requirement.

Prompt changes (all in `app/api/analyze/route.ts`; no schema, API, frontend, database, gap-priority-normalization, resume-identity, or persistence changes):

1. **TARGET-ROLE ANCHOR** — new subsection at the top of OUTPUT REQUIREMENTS. Every output field must evaluate against the supplied TARGET ROLE, TARGET LEVEL, and JD exclusively. Explicit permission to describe evidence as "Senior-level" when explaining why it falls short for a Principal target, and explicit prohibition on silently substituting a different role/function/level as the frame of evaluation.
2. **REASONING FLOW** — new subsection immediately after TARGET-ROLE ANCHOR. Names the intended pipeline: target → JD requirements → evidence type + strength at target scope → met/partial/not_met → target-relative signals → material hiring consequence → gaps → core_verdict → final consistency check. Not a schema change; a reasoning-order instruction.
3. **ROLE REQUIREMENTS `assessment` tightening** — the assessment rules now explicitly incorporate the EVIDENCE STRENGTH TEST. `assessment = "met"` requires sufficiently strong DIRECT or strong SUPPORTING evidence at the target-role scope; thin DIRECT evidence (activity language without adequate ownership/scope/complexity/outcome for the target level) is `partial`, not `met`. Explicit "Thin DIRECT ≠ met." This is the earliest point in the pipeline where the CAL-02 chain broke, so the fix is applied there.
4. **CRITICAL GAPS correspondence rule** — every emitted gap must correspond to either (a) a role_requirement with `assessment` = `partial`/`not_met` whose unresolved weakness is material for the target role/level, OR (b) a material JD-required capability that should have been represented in role_requirements (in which case: prefer correcting role_requirements rather than emitting a disconnected gap). Explicit prohibition on emitting a gap that contradicts a `met` requirement — revisit the requirement assessment instead. Zero-gap validity restated: zero gaps remains valid when no gating/high requirement represents a material unresolved concern — a partial assessment does NOT automatically require a gap.
5. **FINAL CONSISTENCY CHECK** — new top-level section between the numbered outputs and STYLE. Four numbered consistency verifications: (1) for every gating/high requirement assessed partial or not_met, decide materiality and propagate consistently; if non-material, justify with requirement-specific compensating evidence, not with unrelated overall strength; (2) if any signal rationale identifies materially thin/indirect/not-explicit/below-target-scope evidence, that conclusion must be consistent with the associated requirement assessment and gaps; (3) every gap must correspond to a partial/not_met requirement or a JD-required capability that should have been in role_requirements; (4) positioning_summary must evaluate against the supplied target — revise if drifted. Explicit "this is a CONSISTENCY check — not a deterministic verdict rule, not a gap quota, not a requirement that every partial become a gap, and not a numerical scoring system. Zero gaps and Strong Hire remain reachable whenever the evidence honestly supports them."
6. **Removed the V2.3.1 PRINCIPAL ALTITUDE CONSISTENCY CHECK** — the general FINAL CONSISTENCY CHECK subsumes it. The V2.3.1 PRINCIPAL STRONG HIRE — required vs. NOT required subsection is preserved because it lists JD-relative Principal-altitude dimensions that are useful when the model applies the tightened assessment step to Principal targets.

Preserved from V2.1/V2.2/V2.3/V2.3.1 unchanged: GROUNDING (STRICT), EVIDENCE HIERARCHY (direct/supporting/adjacent/none), Evidence Type vs Strength distinction, Ownership/Scope/Complexity/Outcome test, Thin Evidence Rule, ABSENCE OF EVIDENCE ≠ ABSENCE OF CAPABILITY, capability-vs-evidence-gap distinction, positive-evidence protection, zero-gap permission, GAP COUNTER-EVIDENCE TEST, JD-Grounding Test, Semantic Overlap Pass, quantified-impact calibration, target-role-relative signal scoring, SENIOR STRONG HIRE — required vs. NOT required subsection, PRINCIPAL STRONG HIRE — required vs. NOT required subsection (JD-relative altitude dimensions), Strong Hire / Borderline / Below Bar definitions, signal scoring anchors, AI-owned `core_verdict`, the JSON schema, resume identity resolution, gap-priority normalization (server-side arrayIndex+1), and the frontend flow.

Explicitly NOT in V2.3.2:

- No deterministic verdict layer — `core_verdict` is still AI-generated. V2.4 remains deferred, contingent on V2.3.2 measurement.
- No numerical weighting formula, no fixed score thresholds, no "one partial = one gap" rule.
- No schema, API, database, or frontend changes.
- No gap quota. Zero gaps remains valid; Strong Hire remains reachable.
- No mandatory gaps. A partial assessment does not automatically create a gap.
- No candidate-specific tuning — the prompt contains no test-case names, no "Alex", "Morgan", "Jordan", "Maya", "Priya", "Rachel", "Jamie", "Daniel", "Taylor", "Chris" references.
- No broadening of the Principal bar beyond what the target JD supports.
- No weakening of Senior-side calibration or the V2.3 Senior fix.

Decision rule (post-V2.3.2 rerun):

- Targeted 5-case gate first: CAL-01, CAL-02, CAL-09, CAL-10, CAL-11. Gate passes when CAL-01 stays Strong Hire and its executive-influence gap is resolved (either the requirement drops to `partial` and the gap is justified, or the gap disappears); CAL-02 lifts to Borderline with the long-term-platform-strategy requirement now `partial` and a Principal-altitude gap present; CAL-09 stays Borderline; CAL-10 lifts to Borderline with positioning_summary referencing Principal Technical PM (not Senior PM) and a technical-depth gap present; CAL-11 stays Strong Hire with gaps allowed empty.
- Only if the gate passes: rerun the full frozen 12-case suite. Track verdict agreement + three new consistency metrics: (a) cross-stage consistency contradictions — signal rationale flags a material weakness that does not appear in gaps and is not represented as partial/not_met; (b) target-frame drift — positioning_summary/verdict references a different role or level than the supplied target; (c) requirement–gap correspondence — gaps that don't map to a partial/not_met requirement or to a JD-required capability that should have been in role_requirements.
- 12/12 exact verdict agreement AND all three new consistency metrics improved AND Priya stays Strong Hire with gaps [] → V2.3.2 ships; V2.4 remains deferred.
- CAL-11 regresses (Priya loses Strong Hire) → the tightened assessment or consistency check has hidden bias; tune inside V2.3.2, do NOT advance to V2.4.
- CAL-01, CAL-04, CAL-05 regress → Senior-side collateral damage from the new anchor or consistency check; revisit Senior/Principal isolation in the consistency check.
- CAL-02 or CAL-10 does not lift → the assessment tightening or the target-role anchor is not strong enough; tune inside V2.3.2.
- Anything worse than V2.3 overall → roll back to V2.3 (accepting the CAL-02/CAL-09 Principal miss) and reassess whether V2.4 is now the right next step.

### V2.3.3 scope (calibration + coherence only, no deterministic verdict)

Applied on top of V2.3.2 after the 5-case validation gate showed 4/5 agreement with two localized remaining defects: target-role frame drift (CAL-10 concluding for a Senior enterprise SaaS role, CAL-11 opening by calling the Principal target "Senior-level") and verdict decoupling from an identified material weakness (CAL-10 Strong Hire despite a `partial` high-importance technical requirement, 3/5 technical_depth signal, a valid technical-depth gap, and a positioning_summary saying "moderate uncertainty about your fit"). V2.3.3 addresses only those two loci without retuning evidence hierarchy, evidence strength framework, Senior/Principal altitude calibration, signal scoring, JD grounding, gap generation, semantic overlap, positive-evidence protection, or the capability-vs-evidence-gap distinction.

Failure modes addressed:

- **Target-role frame drift despite three anchor statements** — V2.3.2 has TARGET-ROLE ANCHOR (top of OUTPUT REQUIREMENTS), a POSITIONING SUMMARY bullet, and FINAL CONSISTENCY CHECK step 4, all worded as prohibitions. Prohibitions are enforced only at a re-read pass. When the model wants to end on a positive note ("strong hire for [X]"), it drifts X and each guard says "don't do this" but never says "here is what you must do." The fix requires a POSITIVE structural rule at generation time, not another prohibition.
- **Verdict decoupling from identified material weakness** — the V2.3.2 STRONG HIRE bullet "no material hiring uncertainty remains in critical areas" is reader-selectable (the model treats "critical areas" as whatever it decided was critical, not the gating/high requirements it itself extracted). The V2.3.2 FINAL CONSISTENCY CHECK step 1 YES branch says "let it affect core_verdict as appropriate," which is permissive — "affect" can mean "add a gap and keep Strong Hire." Both must be tightened to explicitly tie material concerns to the model's own extracted requirements and to state incompatibility with Strong Hire.

Prompt changes (all in `app/api/analyze/route.ts`; no schema, API, frontend, database, gap-priority-normalization, resume-identity, or persistence changes):

1. **POSITIONING SUMMARY structural anchor** — the two prohibition-style bullets are replaced with positive structural requirements. Opening sentence MUST name the supplied TARGET ROLE and TARGET LEVEL verbatim as the frame of evaluation. Concluding hiring-fit statement MUST reference the same supplied target. Prohibition against closing with a positive hiring conclusion for a different role/level as an alternative or rescue is retained but now backstops a positive rule the model must satisfy at generation time. Cross-level references remain explicitly permitted as explanatory evidence — describing the LEVEL of evidence is different from substituting the evaluation FRAME. Example allowed: "your demonstrated scope is primarily Senior-level, creating uncertainty for this Principal target." Example prohibited: "you are a strong hire for a Senior PM role" when the target is Principal Technical PM.
2. **STRONG HIRE bullet 4 rewritten** — the vague "no material hiring uncertainty remains in critical areas" is replaced with "no gating or high-importance role_requirement carries a material unresolved hiring concern for the exact target role and level." A new paragraph immediately below states: "A material unresolved hiring concern on a gating or high-importance requirement for the exact target role and level is INCOMPATIBLE with Strong Hire. Determine Borderline vs Below Bar using the existing verdict definitions and the severity of the unresolved hiring concerns — Borderline vs Below Bar remains an AI judgment, not a mechanical rule. Strong performance on unrelated requirements does NOT compensate for a material target-specific weakness on a gating or high requirement." The "Strong Hire must remain reachable" paragraph is preserved and extended with an explicit CAL-01-shaped carve-out: "A partial requirement or gap that you judge NON-MATERIAL to the hiring decision for the exact target role may coexist with Strong Hire (see FINAL CONSISTENCY CHECK step 1 for the materiality test)."
3. **FINAL CONSISTENCY CHECK step 1 tightened** — the YES branch previously said "represent it as a gap, keep it consistent with signal rationales and positioning_summary, and let it affect core_verdict as appropriate." Replaced with: "represent it as a gap and keep it consistent with signal rationales and positioning_summary. A material unresolved hiring concern on a gating or high-importance requirement is INCOMPATIBLE with Strong Hire for the supplied target (see STRONG HIRE above). Borderline vs Below Bar remains an AI judgment governed by the existing verdict definitions and the severity of the unresolved concerns — strong performance on unrelated requirements does NOT compensate." The NO branch is preserved and extended with: "A non-material partial (and any coexisting gap) MAY remain compatible with Strong Hire — Strong Hire does not require perfection or zero gaps." This explicitly protects the CAL-01 pattern (partial + gap + Strong Hire when the model judges the partial non-material).
4. **FINAL CONSISTENCY CHECK step 4 trimmed** — since POSITIONING SUMMARY now carries the load-bearing anchor rule, step 4 is trimmed to a one-line pointer back at that rule instead of restating the prohibition. Removes redundancy that would otherwise let the model satisfy one and drift on the other.

Preserved from V2.1/V2.2/V2.3/V2.3.1/V2.3.2 unchanged: GROUNDING (STRICT), EVIDENCE HIERARCHY (direct/supporting/adjacent/none), Evidence Type vs Strength distinction, Ownership/Scope/Complexity/Outcome test, Thin Evidence Rule, ABSENCE OF EVIDENCE ≠ ABSENCE OF CAPABILITY, capability-vs-evidence-gap distinction, positive-evidence protection, zero-gap permission, GAP COUNTER-EVIDENCE TEST, JD-Grounding Test, Semantic Overlap Pass, quantified-impact calibration, target-role-relative signal scoring, SENIOR STRONG HIRE — required vs. NOT required subsection, PRINCIPAL STRONG HIRE — required vs. NOT required subsection (JD-relative altitude dimensions), Borderline / Below Bar definitions, signal scoring anchors, TARGET-ROLE ANCHOR block covering all output fields, REASONING FLOW, tightened ROLE REQUIREMENTS assessment (type + strength), CRITICAL GAPS correspondence rule, AI-owned `core_verdict`, the JSON schema, resume identity resolution, gap-priority normalization (server-side arrayIndex+1), and the frontend flow.

Explicitly NOT in V2.3.3:

- No deterministic verdict layer — `core_verdict` is still AI-generated. V2.4 remains deferred, contingent on V2.3.3 measurement.
- No mapping "gating material concern → Below Bar" or "multiple material concerns → Below Bar." Borderline vs Below Bar remains an AI judgment governed by the existing verdict definitions and the severity of the unresolved concerns.
- No numerical weighting formula, no fixed score thresholds, no "any partial ⇒ Borderline" rule.
- No schema, API, database, or frontend changes.
- No gap quota. Zero gaps remains valid; Strong Hire remains reachable.
- No mandatory gaps. Materiality remains an AI-owned judgment.
- No candidate-specific tuning — the prompt contains no test-case names.
- No changes to Senior/Principal altitude calibration, evidence hierarchy, evidence strength framework, signal scoring, JD grounding, semantic overlap, positive-evidence protection, or capability-vs-evidence-gap distinction.

Decision rule (post-V2.3.3 rerun):

- Rerun the same targeted 5-case gate first (CAL-01, CAL-02, CAL-09, CAL-10, CAL-11).
- Gate passes when: CAL-01 stays Strong Hire with the high/partial executive-influence requirement and its coexisting gap preserved (non-material Senior partial); CAL-02 stays Borderline with the same requirement pattern; CAL-09 stays Borderline; CAL-10 lifts to Borderline with technical-depth requirement still `partial`, technical-depth gap preserved, positioning_summary anchored to Principal Technical PM opening and closing, verdict driven by the material technical uncertainty; CAL-11 stays Strong Hire with gaps [] and positioning_summary opening naming the Principal target correctly (not "Senior-level Developer Platform PM").
- Only after the gate passes: rerun the full frozen 12-case suite. Track verdict agreement + four consistency metrics: (a) target-role drift — string check that positioning_summary opening and closing reference the supplied TARGET LEVEL and TARGET ROLE, count of drifts; (b) material-weakness / verdict contradiction — count of outputs where positioning_summary or signal rationale flags material target-role uncertainty AND core_verdict is Strong Hire; (c) requirement-gap consistency — preserved from V2.3.2; (d) zero-gap positive-control preservation — CAL-11 must remain zero-gap Strong Hire.
- 12/12 exact verdict agreement AND all four consistency metrics improved AND Priya stays Strong Hire with gaps [] → V2.3.3 ships; V2.4 remains deferred.
- CAL-01 regresses to Borderline → the compatibility rule is being applied on non-material partials; tune inside V2.3.3, do NOT advance.
- CAL-11 regresses (Priya loses Strong Hire or gains gaps) → the compatibility rule is firing without a partial being present, or the anchor is triggering fabricated weaknesses; tune inside V2.3.3, do NOT advance.
- CAL-10 does not lift → the compatibility rule is not being read as strongly incompatible; tune inside V2.3.3.
- Anchor rule bleeds into evidence description (model stops referencing "Senior-level scope" when explaining Principal shortfall on CAL-02 or CAL-09) → the comparison-references-allowed carve-out is being interpreted as prohibition; tune inside V2.3.3.
- Anything worse than V2.3.2 overall on the full suite → roll back to V2.3.2 and re-diagnose.

## Next Session

V2.3.3 is implemented in code (prompt-only) but uncommitted, on top of the uncommitted V2.3.2 / V2.3.1 / V2.3 / V2.2 diffs and the earlier V2.2 gap-priority persistence fix. Recommended first steps in order:

1. Review the uncommitted diff in `app/api/analyze/route.ts` for any final tweaks before commit. V2.3.3 touches four sections: POSITIONING SUMMARY (positive target anchor), STRONG HIRE (bullet 4 rewrite + incompatibility paragraph + CAL-01 carve-out extension), FINAL CONSISTENCY CHECK step 1 (YES branch tightening + NO branch coexistence clause), FINAL CONSISTENCY CHECK step 4 (trimmed to pointer at POSITIONING SUMMARY).
2. Run the 5-case validation gate first (CAL-01, CAL-02, CAL-09, CAL-10, CAL-11) before rerunning the full frozen 12-case suite. This mirrors how V2.3.1 and V2.3.2 were validated.
3. If the gate passes, rerun the frozen 12-case calibration suite against V2.3.3 (unchanged test cases). Compare V2.3.2 vs V2.3.3 on the metrics listed under the V2.3.3 decision rule above.
4. Only after V2.3.3 results are analyzed: decide whether V2.4 deterministic verdict is still needed.

Do NOT add new test cases before rerunning the existing suite.
Do NOT tune the prompt to specific named test cases — they are acceptance tests, not tuning targets.
Do NOT advance to V2.4 (deterministic verdict) before V2.3.3 results are evaluated.
Do NOT weaken the V2.3 Senior-side calibration, V2.3.1 Principal Strong Hire guidance, or V2.3.2 coherence rules when fixing the target-anchor / material-weakness defects.
Do NOT reintroduce a Principal-specific consistency check — the general FINAL CONSISTENCY CHECK subsumes it.
Do NOT introduce a deterministic mapping "gating material concern → Below Bar" or "multiple material concerns → Below Bar." Borderline vs Below Bar remains AI-owned.

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