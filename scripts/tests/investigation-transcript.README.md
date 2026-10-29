# Restoring saved investigation conversations

## Baseline and findings

Remote inspection on 2026-10-28 local: main remains `c95d5c1`; PR #4 is an
unmerged draft at `52034c5`. This branch starts from that PR's saved-navigation
implementation. Its draft PR targets `codex/investigation-navigation` so reviewers
see only this increment; it should be retargeted after the dependency is merged.
Neither PR #4, PR #3 nor Phase 2a was merged or modified.

The baseline already queries turns by investigation/user, orders by `turn_index`,
passes the bundle as `initialBundle`, and maps **all returned turns**. There is no
intentional latest-question-only filter. Deterministic multi-turn rendering does
not reproduce actual missing persisted messages on the baseline.

Confirmed presentation defect: the mount effect unconditionally scrolls to the
bottom, moving prior context out of view when reopening; it repeats when sending
changes. The view has no explicit saved-history/current-question distinction.
Also, the page did not key its stateful client by investigation ID: `useState`
does not reinitialize from new props, so a preserved component instance could
retain another conversation when navigating between IDs. That is a code-level
risk, not a claim that it occurred in the reported browser session.

Retrieval previously used one capped REST response and a single sort key; it now
paginates with stable ordering. Truncation is a defensive fix, not a confirmed
cause of this short-session report (the usual REST cap exceeds normal transcript
length). Retrieval errors previously threw through the page instead of presenting
a conversation-specific reload path. The precise cause of the user's observed
session still needs authenticated browser/data verification; do not claim a
production persistence loss was reproduced or repaired.

## Data flow and changes

1. Existing analysis navigation selects the exact saved investigation (PR #4).
2. Detail page authenticates, verifies the existing owned active profile, and calls
   `loadInvestigationBundle(id, userId, profileId)`. No fallback profile creation.
3. The bundle helper verifies ownership/profile, then reads all turn pages with
   exact investigation/user filters and `turn_index, created_at, id` ascending.
   A failed page never yields partial success. A saved answer count below the
   investigation's recorded completed exchanges also fails visibly. Evidence
   loading/confirmation semantics are unchanged.
4. The page keys the client by investigation ID. All persisted turns render in one
   chronological list: CareerMind questions and user responses retain their
   existing differentiated styles. The last assistant message is labeled Current
   question only for an active investigation. It is rendered once, immediately
   before the response controls, not copied into a second question block.
5. Initial restoration does not scroll or focus away from history. A successful
   explicit answer submission retains existing POST behavior, replaces the bundle
   with the persisted response, and scrolls to the new content. Concluded and
   abandoned records expose no answer input. Evidence controls are unchanged.
6. Missing initialization retains PR #4's explicit error; a genuinely new kickoff
   is labeled as having no saved answers. A last persisted user answer without an
   assistant follow-up shows history plus a reload error, not another answer box.
   Retrieval failures show a separate recoverable error. No path regenerates or
   deletes history, reactivates an investigation, or calls AI on restoration.

No schema, persistence model, agent, evaluator, quota or creation changes.

## Verification

- `npm run test:investigation-navigation`: **38 passed** (26 existing + 12 added).
  Tests execute real server/API readers, pages and React rendering, with network
  boundaries mocked. Added cases cover multi-turn active/concluded/abandoned pages,
  ordering and full pagination, identical reload, one current question, conversation
  isolation, partial/failed reads, pending follow-up, new-session labeling and
  client keys. A deterministic hook-boundary test runs the real effect/submission
  callback to verify no scroll on restore and scrolling after an explicit answer.
- `npm run test:action-plans`: **14 passed**.
- `node --import tsx scripts/eval/tests/metrics.test.ts`: **15 passed**.
  The usual `npm run eval:test` command hit the sandbox's IPC-listener restriction;
  direct Node execution ran the same tests successfully without the CLI listener.
- Separate `npx tsc --noEmit --incremental false`, scoped ESLint, `npm run build`
  and `git diff --check`: passed. Existing middleware-to-proxy warning remains.
- PR #3 compatibility: **49 recommendation tests passed** in a temporary archive
  of `d0f9022` combined with these source changes. The shared client has overlapping
  edit context, so the unchanged PR #3 recommendation import/section was manually
  retained in that temporary copy; a plain patch did not apply automatically.
  This is deterministic compatibility evidence, not a merge, independent review
  of the eventual combination, or a real-model evaluation. No actual AI calls.

## Remaining verification and risks

No authenticated browser or live Supabase session was used. Server-rendered markup
and hook tests do not prove browser scroll position/hydration, real RLS behavior,
or the contents of the originally reported investigation. Verify on the correct
preview with a dedicated test user: answer several questions, return via analysis,
continue, inspect all prior messages, refresh, then inspect concluded/abandoned
history. Verify profile switching denies old-profile detail access.

The answer-count check detects a short transcript relative to completed exchanges;
it cannot detect every form of historical corruption or repair missing messages.
Reads are not a transactional snapshot; concurrent changes still require reload.
Existing creation races, nontransactional kickoff/later-turn writes and support
recovery limits from PR #4 remain. No exactly-once or concurrency claim is added.
Do not regenerate historical answers to fill gaps.
