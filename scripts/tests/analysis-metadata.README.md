# Exact analysis source metadata

Independent branch from main `c95d5c1`. No investigation PR dependency or merge.

## Findings and change

The analyzer already persists `analyses.resume_id` from the server-resolved resume
and `analyses.job_description_id` from the associated target job. Resume creation
stores the supplied original filename in `resumes.file_name`; target jobs persist
`job_descriptions.role_title`. These existing relationships/fields need no migration.

The detail page previously used `analysis.resume_name`/`analysis.job_title` plus
generic labels and an AI-generated company-name fallback. The normal analyzer
insert does not supply those display fields. The page now uses two parallel,
read-only metadata lookups **after** authorizing the exact analysis:

- `resumes.file_name`, filtered by the analysis's resume ID, user and profile.
- `job_descriptions.role_title`, filtered by its job ID, user and profile.

No lookup is made for an absent source ID; no latest/active resume, newest job,
title/code similarity, legacy display label, company, verdict or AI text is used
as a substitute. Only one scalar field is selected from each linked table. No
file contents, storage operations, privileged client, AI call or new API is needed.

Missing/deleted/inaccessible/blank source metadata says "Resume filename unavailable
for this analysis" or "Target job title unavailable for this analysis". Read errors
instead say the respective metadata is temporarily unavailable. Metadata failure
does not hide or change the saved verdict/summary. Original filename/title text is
escaped by React and available in a hover title when the existing strip truncates it.

Changes: `app/dashboard/[id]/page.tsx`, test command in `package.json`, production
page tests and these notes. Verdict text, summary selection, evaluation logic,
existing profile resolution and other page behavior are unchanged. The new source
reads are session-scoped and read-only; no new profile fallback behavior is added.

## Verification (2026-10-29 America/New_York)

- `npm run test:analysis-metadata`: **19 passed**. Actual page, existing profile
  resolver and React components execute with only Supabase/router boundaries mocked.
  Tests cover exact old/new source associations, reload after new uploads, null
  IDs, deleted rows, blank fields, legacy missing-profile rows, cross-user/profile
  isolation for analysis/resume/job, authentication, error fallbacks, unchanged
  verdict/summary and safe text/hover rendering. Database doubles have no mutation,
  storage or RPC methods; privileged-client/AI imports fail the suite.
- `npm run test:action-plans`: **14 passed**.
- Separate TypeScript, scoped ESLint, production build and diff checks passed.
  The existing middleware-to-proxy build warning remains.
- Temporary compatibility check with PR #6 at `25727b4`: the metadata page patch
  applied cleanly to that source snapshot. **66 tests passed**: all 19 metadata
  cases plus all 47 navigation/transcript tests. This temporary copy is not a merge
  or modification of any investigation branch.

No paid model calls, live database writes, migrations or production configuration
changes. Tests are rendered-page/contract checks, not authenticated browser or
deployed RLS verification.

## Limits and manual verification

No live authenticated Supabase/browser test was performed. Check the preview with
a dedicated test user: open an old analysis after uploading a different resume,
confirm its original linked filename/title, refresh, open another candidate's
analysis, and verify missing metadata uses the explicit fallback. Confirm verdict
copy stays unchanged and long filenames remain inspectable.

These are labels from the exact **linked records**, not immutable metadata
snapshots. Editing a linked job's role title later changes the displayed label;
deleting that job/resume, missing legacy relationships, or incomplete profile
scope yields unavailable metadata. This increment deliberately does not reconstruct
historical titles, backfill associations, infer candidate names, or add snapshots.
