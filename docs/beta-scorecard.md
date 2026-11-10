# CareerMind weekly beta scorecard

The scorecard adapts the definitions in [beta-telemetry.sql](beta-telemetry.sql).
One service-only SQL function aggregates the report and the prior week.
The endpoint renders HTML and plain text and sends one message through Resend.
It does not call OpenAI or change usage accounting, telemetry, or business records.

## Reading the email

- Weeks run from Monday 00:00 inclusive to the following Monday 00:00 exclusive
  in America/New_York. Each midnight is converted independently, including DST.
- Registrations are current non-anonymous Auth accounts created in the week.
  Verified external beta is the operator-approved roster of existing
  non-anonymous accounts, not inferred from email domain or signup activity.
  Internal/test wins overlap. Unlisted accounts are unclassified. Current roster
  membership is used for both weeks and may differ from historical membership.
- Weekly active users include completed analyses, user replies, qualifying task
  updates, or recorded Production AI calls. This is not a count of logins.
  Returning analysis users completed an analysis on an earlier New York date.
  An initialized investigation has an opening assistant turn. A conclusion
  requires a concluded investigation and a saved concluding assistant turn.
- Business records share a database across environments and may include Preview
  or development activity. Only provider telemetry is filtered to Production.
- Spend sums only known receipt estimates. A null sum is displayed as a dash,
  and unknown-cost calls remain counted. Workflow means include only observed
  groups with known costs and required correlation IDs for all recorded calls
  in the window. Compare groups by operation, analysis by saved analysis, and
  kickoff and turns by investigation. Unlinked calls still count toward spend
  when priced. Recommendations and narratives are separate. These are not
  lifetime costs or billed amounts; missing telemetry can undercount.
- Mean latency is the provider request latency, not end-to-end latency.
  Provider outcomes do not measure application validation or persistence.

## Configuration and activation (only after separate approval)

1. Verify a sender domain in Resend. Use a sending-only key scoped to that domain
   if supported by the account. No new Supabase credential is needed.
2. Configure these variables in **Production Vercel only**. Do not copy secrets
   into the repository or logs.

| Variable | Value |
| --- | --- |
| `BETA_SCORECARD_SECRET` | Random secret of at least 32 characters; same value in GitHub Actions secrets |
| `RESEND_API_KEY` | Sending-only key for the approved Resend account |
| `BETA_SCORECARD_FROM` | Plain email address at the verified domain |
| `BETA_SCORECARD_TO` | The approved operator mailbox, as one plain email address |
| `BETA_SCORECARD_EXTERNAL_IDS`, `BETA_SCORECARD_INTERNAL_IDS` | JSON arrays of account UUIDs; use explicit `[]` for an empty roster; include canaries in internal/test |
| `BETA_SCORECARD_SEND_ENABLED` | Leave unset until real delivery is approved; only literal `true` enables sending |

3. With approval, apply only the scorecard migration and verify browser denial
   of both the table and RPC, and successful service-role aggregate access.
4. After an approved Production deployment, set GitHub Actions repository
   variable `BETA_SCORECARD_WORKFLOW_ENABLED` to `true` and run **Weekly beta
   scorecard → Run workflow → dry_run** on main while sending is disabled.
   It validates and renders privately; no delivery row, mail request, report
   output, or artifact is created. The workflow logs only HTTP status.
5. Enable sending only after explicit approval. The scheduled trigger is Monday
   09:00 New York time. GitHub can delay or drop scheduled runs and disables
   them in inactive public repositories after 60 days. A missed run can be
   started with the manual procedure below. Do not rely on exact inbox time.

## Manual retry

1. Identify the missed reporting Monday (week start, not delivery date) and
   check the delivery row's state, creation time, and lease. Logs use only
   event, week and stage; never include provider messages, IDs, credentials,
   recipients, report HTML, or cohort details.
2. Run the workflow on **main**, choose `retry`, and enter that Monday as
   `YYYY-MM-DD`. If no row exists, it can generate the missed report for a
   completed week within the supported reporting horizon (77 days). If already
   accepted, it skips. An in-flight claim cannot be reclaimed until its two-minute
   lease expires.
3. For a timed-out or uncertain attempt, retry only within 23 hours of the
   original claim and with the same Resend account and sender/recipient. The
   endpoint atomically reclaims the week and resends the exact frozen payload
   with the same key. A provider-accepted row drops its payload and keeps the
   week and receipt so a later retry remains a no-op.
4. After 23 hours, or if the provider account or sender/recipient changed,
   reconcile against the provider dashboard before any further action. Do not
   delete or reset the row to bypass the guard. If acceptance cannot be verified,
   leave the week unresolved rather than risk a duplicate. Acceptance is not
   proof of inbox delivery; check bounces in Resend.

Disable the GitHub workflow variable to stop new scheduled requests. Keep the
delivery rows when rolling back application code; they preserve deduplication.
No shared migration, configuration change, or email send is part of PR review.

## Local validation

`npm run test:scorecard` uses a mocked provider and a disposable PostgreSQL
cluster (`initdb`, `pg_ctl` and `psql` on PATH). It does not use hosted Supabase,
production credentials, or Resend. Run TypeScript, scoped ESLint and the local
production build before opening the draft PR.
