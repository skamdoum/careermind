# Saved Gap Investigation discovery and navigation

Baseline: `origin/main` at `c95d5c1` (Increment 1). This change does not include,
merge or modify PR #3's evaluator, the investigation agent, or Phase 2a.

## Behavior

- The analysis page reads saved investigation summaries with the session client,
  scoped to the authenticated user, verified existing active profile, exact live
  analysis, and exact seed gap. It does not create/fall back to another profile.
- Primary selection: newest active investigation, otherwise newest concluded,
  ordered by `created_at DESC, id DESC`. An older active record takes precedence
  over a newer concluded one. All records remain visible in per-gap history,
  including the primary and abandoned records. Abandoned records are never resumed
  by the creation endpoint; abandoned-only history still permits a fresh attempt.
- If a seed-gap reference is null or no longer listed, the record appears under
  "Other saved investigations from this analysis". It is never reassigned by
  title/code. A null seed-analysis reference cannot be attributed to this analysis
  and is not inferred from snapshots; existing owned detail URLs still work within
  the active profile.
- Existing links open the saved detail page directly. There is no creation POST,
  upload or AI call on navigation. Turns, conclusions and evidence are loaded from
  existing rows. Abandoned detail pages show the transcript without an answer box;
  evidence validation behavior is unchanged.
- Creation verifies the seed gap and its analysis, then applies the same selection
  before downloads, uploads, inserts or kickoff. A failed discovery read blocks
  creation rather than treating unknown history as empty.
- The UI ref prevents repeated clicks before React rerenders. A successful start
  keeps the control busy until navigation; a failure permits an explicit retry.
- Saved detail/GET now enforce owned active-profile membership before loading the
  bundle. The bundle helper accepts an optional profile filter; existing turn and
  evidence mutation authorization paths remain unchanged.

## Incomplete initialization and concurrency limits

A missing saved assistant turn at index 0 is treated as incomplete initialization.
The detail page offers an explicit reload link and explains that saved data is
retained. Creation reuse and GET return HTTP 409 for that condition. A kickoff
failure no longer deletes its investigation row. Reopening/retrying never silently
regenerates that row's kickoff. Reload can recover when another in-flight request
finishes; a permanently failed kickoff needs support intervention. No automated
repair or destructive reset is implemented.

This is a **read-before-insert lookup**, not a distributed lock or idempotency
guarantee. Two tabs/instances can both observe no eligible row and create separate
investigations/AI calls. There is **no exactly-once creation guarantee**. Existing
and future duplicate records remain accessible through history. No deterministic
IDs, unique indexes, RPCs, new tables, schema changes or migrations are introduced.

The existing kickoff writes are not one transaction. Detecting a missing first
assistant turn does not prove that all evidence/conclusion writes succeeded, nor
repair partial later-turn failures. The agent and those write paths are outside
this focused navigation fix. Resume fallback/upload behavior for genuinely new
investigations is unchanged.

## Verification

```
npm run test:investigation-navigation
npm run test:action-plans
npx tsc --noEmit --incremental false
npm run build
```

2026-10-28 local results:

- **26 navigation tests passed**: production readers, selection, creation/GET
  handlers, analysis/detail pages and button callbacks execute with mocked database,
  provider and hook/router boundaries. Coverage includes exact scope, ownership,
  pagination, history/abandoned/deleted gaps, persistence/reload, errors, incomplete
  initialization, no AI on reuse/navigation, new kickoff persistence, and rapid
  click suppression before rerender.
- **14 Action Plan regression tests passed**.
- **49 PR #3 recommendation tests passed** in a temporary archive of `d0f9022`
  with the navigation source changes overlaid. This was a local compatibility
  check only, not a merge or modification of PR #3. No real model calls were made.
- Scoped ESLint, separate TypeScript, production build and diff checks passed.
  One intermediate build failed while cleaning generated `.next/diagnostics`
  with ENOTEMPTY; rerunning the build succeeded without a source/config change.
  The existing middleware-to-proxy deprecation warning remains.

These are deterministic tests, not live database/RLS concurrency or browser
hydration tests. No authenticated Supabase test session or browser flow was used;
actual multi-profile RLS, deployed schema permissions, real navigation and production
records remain unverified. No production records/configuration were changed.

Before release, verify with a dedicated test user: start once, answer/conclude,
validate/edit evidence, return via analysis, reopen the same URL and records;
switch profiles and verify old-profile links are denied; inspect history and an
incomplete record. Concurrent-tab duplication is an acknowledged limitation, not
a passing exactly-once test.
