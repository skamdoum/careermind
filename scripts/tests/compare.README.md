# Compare API security (PR A)

`POST /api/compare` verifies the Supabase user with `auth.getUser()` and rejects
missing/invalid sessions (401) and anonymous Auth users (403). It reads the existing
active-profile pointer and verifies profile ownership without creating a profile.
Both file and pasted-text comparisons require this owned active profile.

## Request and compatibility

Send JSON with one to three nonblank `jobDescriptions` strings and either:

- `resume_id`: UUID of an owned resume in the active career profile (preferred), or
- `latestResume.id`: the same UUID, for compatibility with saved-resume clients, or
- `resumeText`: nonblank pasted resume text.

If both ID fields are supplied they must agree. Client-supplied storage paths,
filenames, MIME types, user IDs and profile IDs do not authorize storage access.
Path-only legacy clients must switch to a saved resume ID. No in-repository caller
of the compare endpoint was found. A supplied file reference cannot fall back to
pasted text when its authorization fails. When an authorized file and text are
both supplied, the file is canonical, consistent with analysis resume isolation;
stale text is not sent alongside another resume.

Limits: 512 KiB actual JSON body bytes, 60,000 resume-text characters, and 30,000
characters per job description (JavaScript string length). The reader bounds
chunked bodies too, independently of Content-Length. Malformed/empty inputs and
invalid cardinality/IDs return 400; oversized inputs return 413; non-JSON media
types return 415. All validation precedes downloads and provider calls.

The session-scoped resume query filters exact ID, user ID and active profile ID;
absent/foreign records return the same 404. The server-only download helper also
requires a canonical object path under `<authenticated-user-id>/`, the existing
upload convention. This additional check matters because metadata registration
currently accepts a client-provided path. Paths containing empty/traversal
segments, encoded characters, backslashes, query/fragment delimiters or controls
are rejected before service-role download. Historical rows outside this convention
fail closed (403); another resume is never substituted. Profile-null legacy rows
also fail closed. No database or storage policies are changed.

Success remains `{ success: true, data: [...] }`, sorted by descending score with
the existing `company_name`, `core_verdict`, `reasoning`, and `score` fields. Model,
system prompt, and Responses API use are unchanged. Errors retain
`{ success: false, error: string }`. Raw model output and internal provider/storage
error details are not logged or returned by this endpoint.

## Verification

Run `npm run test:compare`. Tests execute the production route, bounded reader,
active-profile reader and owned-resume helper. Only Supabase/OpenAI network
boundaries are doubled. Coverage includes auth, anonymous sessions, ownership,
profile isolation, forged references and persisted paths, body streaming/limits,
historical records, zero privileged/provider operations on rejected requests,
one-to-three-job success, pasted text, response compatibility and failure handling.

Run the existing action-plan, analysis-metadata, investigation-navigation and
plan-recommendation test scripts, TypeScript, scoped ESLint and production build.

Results for this change (2026-11-02):

| Check | Result |
| --- | --- |
| Compare regression suite | 59 passed |
| Inherited Storage policy/rollback suite (local PostgreSQL) | 17 passed |
| Action Plan suite | 14 passed |
| Analysis metadata suite | 19 passed |
| Investigation navigation suite | 47 passed |
| Plan recommendation deterministic suite | 49 passed |
| `npx tsc --noEmit` | Passed |
| ESLint on compare route, helpers and test | Passed |
| `npm run build` | Passed; existing middleware-to-proxy deprecation warning |
| Real Auth/Storage/data + guarded local Compare rejection suite | 15 checks passed; cleanup verified |

All 205 automated tests passed after merging `main` at
`89ff182537dff64d44971bd1c10e57b4783ca016`. The package-script conflict retained
`test:compare`, `test:resume-storage`, and `test:resume-storage:live`; this update
also adds `test:compare:live`. Compare production code is unchanged from the
reviewed `24a37665fbc98da113cc9bd6125814db0f3bc88f`; analysis/UI code is unchanged
from main. Storage migrations/rollback files are inherited from merged PR #11,
not new changes in PR #10. No new migration is required or was applied.

## Rejection-only live integration (no paid AI)

`compare.live.ts` exercises the actual built route with real Supabase Auth,
metadata, and three synthetic text resumes belonging to two disposable users.
It requires explicit opt-in to the configured project and a loopback app. The
configured project is shared across Vercel environments; only fixtures created by
this run are changed, never existing users' resume records or file contents.

Run the built local server with the **test-only** `compare-no-ai-preload.mjs`:

```sh
npm run build
# Choose an empty audit file outside the repository and an unused loopback port.
: > /private/tmp/careermind-compare-audit.jsonl
CAREERMIND_COMPARE_TEST_PROJECT_REF=<confirmed-project-ref> \
CAREERMIND_COMPARE_AUDIT_FILE=/private/tmp/careermind-compare-audit.jsonl \
NEXT_TELEMETRY_DISABLED=1 \
NODE_OPTIONS="--import $PWD/scripts/tests/compare-no-ai-preload.mjs" \
npm run start -- --hostname 127.0.0.1 --port 3108

# In another shell, without the preload on the fixture-runner process:
CAREERMIND_COMPARE_TEST_PROJECT_REF=<confirmed-project-ref> \
CAREERMIND_COMPARE_AUDIT_FILE=/private/tmp/careermind-compare-audit.jsonl \
CAREERMIND_COMPARE_TEST_BASE_URL=http://127.0.0.1:3108 \
npm run test:compare:live
```

The preload permits Supabase Auth and database traffic (fixture setup reuses the
existing authorized profile/resume APIs), but blocks and audits every outbound
Storage/provider/unexpected fetch from the app server. The fixture process uploads
and reads only its synthetic files directly. The test verifies that the preload
loaded, observed real Auth/database reads, and recorded **zero blocked attempts**;
an attempted privileged download or provider call fails the test and cannot incur
an AI charge. This instrumentation follows the installed SDKs' fetch boundaries;
it is not a production rate limiter or deployment configuration.

All 15 live checks passed: registered users, canonical uploads/metadata and owned
synthetic downloads, historical associations after a newer upload, unauthenticated
401, foreign-ID 404 in both directions, forged body identity/fallback rejection,
inactive-profile 404, owned metadata with a foreign path 403, path-only/malformed
references, nonexistent IDs, malformed/empty/excessive job arrays, oversized
jobs/text/actual JSON bytes, invalid JSON/media, and missing active-profile 403.
The server audit recorded 70 Auth/database calls and zero Storage/provider/
unexpected attempts. Both disposable users, all metadata and three uploaded
synthetic files were removed; cleanup was verified. No policies, migration history,
Vercel settings, existing resume contents, or Production deployments were changed.

Authorized end-to-end Compare success is **not tested live**: it necessarily calls
OpenAI. The one-to-three-job response contract, file selection and text fallback
remain covered by production-code deterministic tests with provider/network
doubles. These are not actual-model results. Anonymous Auth rejection is covered
deterministically, but anonymous Auth signup was not exercised live. No browser
automation or paid OpenAI calls were performed. Explicit paid-call approval is
needed for a real authorized success smoke test.

No new runtime environment variables, migrations, rate limiting, persistence, Phase 2a
changes or production configuration are included. Existing server environment
variables remain required. Resume binary size/type enforcement and OpenAI SDK
retry behavior are unchanged; this PR bounds comparison request inputs, not file
upload policy or cross-request spending. Rate limiting remains a separate change.

Rollback is application-code rollback only; it would reopen the old compare
vulnerability, so prefer disabling compare over restoring the unsafe handler.
