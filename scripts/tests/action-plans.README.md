# Persisted Action Plan — Increment 1

Run `npm run test:action-plans` without loading `.env.local`. Tests import the real
GET and existing PATCH handlers, the scoped reader, client fetch/save functions,
and React-rendered view. Only the Supabase session/network boundary is replaced
with an in-memory store. Client tests route fetches through those actual handlers.
They verify authorization query scoping and acknowledged writes/reloads; they do
not prove deployed RLS or real browser hydration behavior.

The Action Plan page now displays saved plans/tasks, grouped by career goal,
target job and analysis. Every saved plan for an eligible analysis is shown;
no latest-analysis selection, semantic merging, new plan creation or generated
fallback tasks are performed. Multiple plans are labeled within their analysis.
Saved task statuses drive progress and use the existing authorized PATCH route.
Controls are disabled while saving; failed saves preserve the prior status.

No schema change is required by this implementation: it reads fields already
written by the existing analyze route and uses existing task-status values
(`not_started`, `in_progress`, `done`). The read API authenticates with the server
session client, restricts analyses to the active profile/user, then plans/tasks
to owned parent IDs. Goal/job metadata is independently owner/profile-scoped;
a job must also belong to the analysis's goal before supplying its label/link.
Stable ID ordering, response pagination and bounded IN batches avoid dropping
history under Supabase's default response cap. Reads are not cached.

The old `/api/strategy` endpoint is unchanged, but the Action Plan page no longer
uses its synthetic template actions. Those actions had no saved IDs and status
changes lived only in browser memory; this feature does not invent historical
statuses or migrate them. Repeated/similar tasks from different saved analyses
remain distinct and count separately in progress. Analysis history is labeled.

Missing analyses, missing plans, empty plans, unavailable goal/job metadata and
load/save failures have distinct UI states. No plan is substituted automatically.

Schema verification limitation (2026-10-26): the initial repository migration is
empty. A read-only request for the configured Supabase API schema failed with DNS
ENOTFOUND even with network permission. Exact live constraints, table grants/RLS,
and authenticated browser/storage integration therefore remain unverified.
No database records, grants, migrations or production configuration were changed.

Phase 2a's branch/PR, operation RPCs, and tests are not dependencies of this work.
Semantic matching, proposals, investigation APIs and Increment 2 are excluded.
