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

### V2 strategy — two stages

- **V2.1** — Prompt + structured evidence reasoning improvements. Verdict remains AI-generated.
- **V2.2** — Only if regression testing shows verdict calibration remains unstable, introduce deterministic verdict logic driven by structured requirement assessments.

Do not skip V2.1.

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

- Deterministic verdict layer (V2.2 — deferred until V2.1 measurement).
- DB column for `role_requirements` (stays in `raw_json`).
- UI rendering of `role_requirements` (downstream, will improve passively as `raw_json` improves).

Build + TypeScript: passed at end of session. No known regressions.

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

Decision rule:

- Evidence/gap quality improves AND verdict calibration improves → V2.2 may be optional; measure and decide.
- Evidence/gap quality improves BUT verdict calibration remains inconsistent → proceed to V2.2 deterministic verdict.
- Neither improves → revisit prompt design before V2.2.

## Next Session

V2.1 is implemented in code but uncommitted. Recommended first steps in order:

1. Review the uncommitted diff in `app/api/analyze/route.ts` for any final tweaks before commit.
2. Commit V2.1 with a clean message (e.g., `feat(analyze): evaluation V2.1 — grounded evidence + role requirements`).
3. Rerun the existing V1 regression test suite against V2.1 (unchanged test cases).
4. Compare V1 vs V2.1 using the metrics listed under Regression strategy.
5. Only after V2.1 results are analyzed: decide whether to advance to V2.2 deterministic verdict.

Do NOT add new test cases before rerunning the existing suite.
Do NOT advance to V2.2 before V2.1 results are evaluated.

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