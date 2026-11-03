# AI usage regression tests

See [architecture and activation runbook](../../docs/ai-usage-guard.md).

Run `npm run test:ai-usage` with `initdb`, `pg_ctl` and `psql` on PATH. The suite creates a temporary local PostgreSQL cluster bound only to a Unix socket, uses fake Auth/Storage/OpenAI network boundaries, applies the actual migration/rollback to fixture tables, then stops/removes the cluster. It does not load `.env.local`, contact Supabase, call OpenAI, or deploy. Current verified runtime: PostgreSQL 16.15. PostgreSQL 17 remains an activation verification gate.

The application-table fixture matches inspected API field types/nullability; it cannot establish compatibility with every live constraint/trigger/permission. The initial base migration is empty in the repository. Separate approved live activation testing is essential.

Existing Compare, resume-access, investigation-navigation and recommendation suites double `store.server.ts` as an external RPC boundary, while executing real handlers/guards. `usage-store-double.ts` is not evidence of database atomicity. The new SQL suite supplies that evidence through actual independent connections and production route recovery tests. All provider outputs are synthetic, not accuracy measurements.

No tests in this suite require paid calls. Do not run live benchmark commands or configured-project migrations as part of this test command.
