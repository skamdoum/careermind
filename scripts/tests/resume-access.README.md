# Privileged resume access hardening

## Security boundary

`lib/resumes/download.server.ts` is the only application resume Storage downloader. It accepts a verified authenticated user ID, an owned career profile ID, and an exact resume ID; re-reads metadata through the caller's RLS-scoped client with all three filters; validates the object's owner namespace; then performs the privileged download. Both modules under `lib/resumes/` are server-only. No client-provided metadata authorizes a download.

`lib/resumes/authorization.ts` shares namespace validation with registration. It requires `<authenticated-user-id>/<nonempty-object-path>` and rejects empty segments, dot traversal, percent encoding, query/fragment syntax, backslashes, and ASCII controls. Existing registered rows remain subject to download-time checks, including rows inserted or edited directly through Supabase. The fix requires no schema, policies, environment variables, or data migration.

Analyze and investigation creation retain their existing anonymous Auth policy; Compare retains its registered-account requirement. Unauthenticated requests remain unauthorized. Active-profile resolution behavior is unchanged. Uploaded files remain the canonical source, with pasted text supported only when no file is selected. An invalid, unavailable, or unauthorized explicit reference never falls back to text or another file. Analyze now rejects malformed/conflicting explicit references with 400. Unauthorized namespace references return 403; unavailable owned resume records return 404.

Investigation creation retains saved-investigation reuse before downloads or AI work. An explicit analysis resume ID must resolve; missing/foreign/inactive-profile resumes return 404. Only legacy analyses without a resume ID retain the scoped latest-resume fallback and existing no-file kickoff behavior. Resume lookup failures now fail closed instead of starting a session with substituted or missing resume context.

## Verification

- `npm run test:resume-access`: **64 passed**. Executes the actual Analyze, registration, and investigation POST handlers plus shared guard. Only Supabase/OpenAI/agent network boundaries are doubled; no copied authorization implementation. Authorized mock responses also exercise persistence and response envelopes.
- `npm run test:compare`: **59 passed**, including unchanged Compare response/error contracts.
- `npm run test:resume-storage`: **17 passed** against an isolated temporary local PostgreSQL 16 cluster. This executes the existing migration/rollback SQL only in that disposable fixture database, never configured Supabase environments.
- Existing regressions: investigation navigation **47**, analysis metadata **19**, Action Plans **14**, recommendation validation **49** passed.
- Total: **269 automated tests passed**.
- Local production build passed, with the existing middleware-to-proxy deprecation warning. The initial sandboxed attempt could not fetch Google Fonts; a network-enabled local rerun succeeded without source changes or deployment.
- TypeScript passed after removing an identical ignored `.next/types/routes.d 3.ts` cache duplicate that caused duplicate declarations. No tracked source was changed for that issue.
- Strict scoped ESLint passes for shared helpers, Compare wrapper, investigation route, and changed tests. Analyze and registration retain the same **six existing `no-explicit-any` errors and one unused-variable warning as main**, confirmed using `git show origin/main:<path> | eslint --stdin`. With that existing rule disabled only for those two legacy route checks, there are zero errors and the same unused-variable warning. No lint configuration or source suppressions were added.

Security cases cover cross-user/profile isolation, forged persisted paths, malformed references, no fallback on rejection, metadata changes before the privileged read, registration ownership, canonical file precedence, authorized/anonymous compatibility, legacy fallback, lookup failure, and failed downloads. Rejected references assert zero Storage downloads, file uploads, model calls, and inserts. Existing navigation tests cover saved reuse without AI work.

These are deterministic boundary tests, not live Supabase or browser verification. No paid OpenAI calls, existing resume downloads, policy changes, or configured-database migrations were performed. Successful provider calls use synthetic mocked output and establish API behavior, not model quality.

## Deployment and remaining limitations

Deploy application code normally after review; no database or configuration step is required. Rollback would restore the vulnerable application paths, so prefer a forward fix if issues appear. Do not roll back Storage owner policies.

Object namespaces prove user ownership, not original career-profile provenance: object paths contain the user ID, while the resume metadata row supplies profile association. This patch does not repair historical investigations, cached provider files, or persisted results. Legacy analyses lacking resume IDs still cannot establish exact original-file identity. Read/revalidation and download are not an atomic workflow; the downloaded path is the already-validated local value, so a later metadata edit cannot redirect that download. No changes to AI prompts, agent behavior, recommendation logic, rate limiting, or Phase 2a are included.
