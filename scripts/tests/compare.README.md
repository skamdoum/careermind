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
| Action Plan suite | 14 passed |
| Analysis metadata suite | 19 passed |
| Investigation navigation suite | 47 passed |
| Plan recommendation deterministic suite | 49 passed |
| `npx tsc --noEmit` | Passed |
| ESLint on compare route, helpers and test | Passed |
| `npm run build` | Passed; existing middleware-to-proxy deprecation warning |

These deterministic tests are not live Supabase RLS/storage-policy, authenticated
browser, or actual-model checks. Before production rollout, verify registered and
anonymous sessions against development Supabase, two-user/profile isolation, an
owned historical file download, and existing path conventions in real data.

No new environment variables, migrations, rate limiting, persistence, Phase 2a
changes or production configuration are included. Existing server environment
variables remain required. Resume binary size/type enforcement and OpenAI SDK
retry behavior are unchanged; this PR bounds comparison request inputs, not file
upload policy or cross-request spending. Rate limiting remains a separate change.

Rollback is application-code rollback only; it would reopen the old compare
vulnerability, so prefer disabling compare over restoring the unsafe handler.
