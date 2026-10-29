# Investigation session navigation and progress

Baseline: PR #5 at `d439f6f`, which includes PR #4 (`52034c5`). Both were open
when inspected on 2026-10-28 America/New_York. This branch/PR stacks on PR #5;
neither dependency is merged or changed by this increment.

## Findings and implementation

The active-first selection is intentional: a new active session can take priority
over an older concluded session containing the previous conversation. No transcript
loss is implied by zero answers in the active session. The existing seed-gap,
analysis, user and active-profile scope and primary/history ordering are unchanged.

- Analysis controls now show status, readable creation timestamp, saved answer
  count and short session ID for the primary investigation.
- An active session with zero persisted user responses says **Not started —
  0 answers saved**. This is progress, not an initialization-health assessment.
  Existing missing-first-question detection is unchanged.
- The newest concluded session has a **View completed investigation** link outside
  the history disclosure. If it is already primary, there is just one prominent
  link. When an active session is primary, both links are visible. Selection still
  uses created_at DESC, id DESC; older sessions are never substituted or hidden.
- History retains every active/concluded/abandoned session and now includes the
  same metadata. Unlinked-gap history also uses the shared identity presentation.
- Detail identity is rendered from the current client bundle, so answer counts
  update after an explicit answer submission rather than staying at the initial
  server count. Incomplete initialization also displays session identity. Transcript
  ordering/current-question rendering, conclusions and evidence controls are unchanged.
- `SessionIdentity` reuses Badge and existing styles. Timestamps explicitly use
  en-US/UTC on server and client; this avoids server/browser time-zone differences
  without new user settings. The full ID is available as the short ID's title.

Files: analysis page and investigate-gap control; detail page and client; new
`app/dashboard/gap-investigations/session-identity.tsx`; existing `saved.ts` reader;
expanded navigation tests and these notes. No API/agent/evaluator/Phase 2a changes.

## How saved answers are counted

The turn POST first inserts a user answer, then invokes AI and persists the
assistant response/evidence, and only later updates `gap_investigations.turn_count`.
That counter normally reflects completed exchanges, but can lag persisted user
answers after a provider/persistence failure. It is not reliable for this label.

The analysis page therefore calls a separate read-only count helper with IDs from
the existing authorized discovery result. It requests only `id,investigation_id`
from `gap_investigation_turns`, filtered to the same user, role=user and those IDs.
No message content or full transcript is retrieved for progress. IDs are batched
in groups of 100; answer rows are paginated in groups of 500 with stable ID order.
One batch serves all its gaps/sessions, rather than one query per investigation.
An empty ID set causes zero turn queries. Creation/reuse still calls the original
discovery reader and incurs no new progress query or behavioral change.

Counts are literal saved user-turn rows, including answers awaiting an assistant
reply. They do not imply gap resolution, evidence confirmation or unique conceptual
answers. Counts never combine investigation IDs. A read failure discards partial
counts and shows unavailable metadata plus a reload message, retaining existing
navigation. It is never silently shown as zero. Detail already has the exact
authorized transcript and counts user rows locally; no extra query is needed.

## Verification (2026-10-28 local)

- `npm run test:investigation-navigation`: **47 passed** (38 existing + 9 added).
  Only the expected completed-link copy was updated in existing rendered assertions;
  navigation, restoration, lifecycle, isolation and rapid-click tests still pass.
  Added rendered tests cover the reported zero-answer-active/older-concluded
  scenario using synthetic IDs, visible links to exact IDs, lagging counters,
  newest-concluded tie ordering, all history metadata, detail identity, count-read
  errors and ownership. The 102-session batching fixture uses 3 lightweight reads
  and crosses the answer-page boundary, proving counts are neither N+1 nor truncated.
- `npm run test:action-plans`: **14 passed**.
- `node --import tsx scripts/eval/tests/metrics.test.ts`: **15 passed**.
- Separate TypeScript, scoped ESLint, production build and diff checks: passed.
  Only the pre-existing middleware-to-proxy build warning remains.
- **49 PR #3 recommendation tests passed** in a temporary manually combined copy
  retaining PR #3's unchanged recommendation section alongside this work. This is
  deterministic compatibility evidence, not a merge or model evaluation. Eventual
  integration of the overlapping component edits still needs review.

Tests run production readers, server pages and React rendering with mocked network
boundaries. Rendering verifies the visible completed link outside collapsed history
and status/date/count/ID text. No screenshots, authenticated browser or live Supabase
verification were performed; no real user records, AI calls or production writes
were involved. Fixtures use synthetic session IDs, not the reported production IDs.

## Remaining checks and tradeoffs

Verify the actual preview with a dedicated test user: open the originating analysis,
compare both visible session identities, Continue into the zero-answer active
session, View completed into its separate concluded session, expand all history,
refresh, and switch profiles to verify isolation. Confirm metadata updates after
an explicit answer and that PR #5's viewport/transcript behavior remains intact.

Progress reads and detail loads are separate snapshots. Concurrent answers may
require refreshing the analysis; live subscriptions are intentionally absent.
ID-only row transfer grows with saved answers and is suitable for this beta; no
new aggregate RPC, schema, table, migration, cache, or generic framework is added.
Existing creation races and incomplete-session recovery limits are unchanged.
