import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { formatScorecard, reportSchema, reportingWeek } from "./report";

export const payloadSchema = z.object({
  from: z.email(), to: z.tuple([z.email()]), subject: z.string(), html: z.string(), text: z.string(),
});
export type EmailPayload = z.infer<typeof payloadSchema>;
type Claim = { week_start: string; lease_until: string; attempt_token: string; payload: EmailPayload };
export type Delivery = Omit<Claim, "payload"> & { created_at: string; state: "sending" | "uncertain" | "accepted"; payload: EmailPayload | null };
export type ScorecardStore = {
  report(week: string, external: string[], internal: string[]): Promise<unknown>;
  find(week: string): Promise<Delivery | null>;
  claim(row: Claim): Promise<boolean>;
  reclaim(week: string, token: string, now: string, lease: string, cutoff: string): Promise<boolean>;
  finish(week: string, token: string, providerId: string | null): Promise<void>;
};

const requestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("schedule") }).strict(),
  z.object({ mode: z.literal("dry_run"), week_start: z.string().optional() }).strict(),
  z.object({ mode: z.literal("retry"), week_start: z.string() }).strict(),
]);
const list = z.array(z.uuid()).max(1000);
const retryWindowMs = 23 * 60 * 60 * 1000; // Safety margin before Resend's 24h expiry.
const leaseMs = 120_000;

function authorized(header: string | null, secret?: string) {
  if (!secret || secret.length < 32 || !header) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(header), hash(`Bearer ${secret}`));
}

export function scorecardHandler(store: ScorecardStore, options: {
  env: Readonly<Record<string, string | undefined>>;
  fetcher?: typeof fetch;
  now?: () => Date;
  warn?: (event: { event: string; week_start: string; stage: string }) => void;
}) {
  const { env, fetcher = fetch, now = () => new Date(), warn = event => console.warn(JSON.stringify(event)) } = options;
  const response = (status: number, result: string) =>
    Response.json({ result }, { status, headers: { "Cache-Control": "no-store" } });

  return async function handle(request: Request) {
    if (env.VERCEL_ENV !== "production") return response(404, "not_available");
    if (!authorized(request.headers.get("authorization"), env.BETA_SCORECARD_SECRET)) return response(401, "unauthorized");
    let input: z.infer<typeof requestSchema>;
    let week: ReturnType<typeof reportingWeek>;
    try {
      input = requestSchema.parse(await request.json());
      week = reportingWeek(now(), input.mode === "schedule" ? undefined : input.week_start);
    } catch {
      return response(400, "invalid_request");
    }
    const dry = input.mode === "dry_run";
    if (input.mode === "schedule" && !week.scheduleDue) return response(200, "not_due");
    if (!dry && env.BETA_SCORECARD_SEND_ENABLED !== "true") return response(200, "sending_disabled");

    const key = week.weekStart;
    let stage = "configuration";
    try {
      const from = dry ? undefined : z.email().parse(env.BETA_SCORECARD_FROM);
      const to = dry ? undefined : z.email().parse(env.BETA_SCORECARD_TO);
      if (!dry && !env.RESEND_API_KEY) throw new Error("Missing mail credential");
      const buildReport = async () => {
        stage = "configuration";
        const external = list.parse(JSON.parse(env.BETA_SCORECARD_EXTERNAL_IDS ?? "null"));
        const internal = list.parse(JSON.parse(env.BETA_SCORECARD_INTERNAL_IDS ?? "null"));
        stage = "report";
        const report = reportSchema.parse(await store.report(key, external, internal));
        stage = "format";
        return formatScorecard(report, week);
      };
      if (dry) {
        await buildReport();
        return response(200, "dry_run_rendered");
      }

      stage = "lookup";
      const existing = await store.find(key);
      if (existing?.state === "accepted") return response(200, "already_accepted");
      if (existing && input.mode !== "retry") return response(409, "manual_retry_required");

      const token = randomUUID();
      let payload: EmailPayload;
      if (existing) {
        const time = now();
        const created = Date.parse(existing.created_at);
        const leaseExpiry = Date.parse(existing.lease_until);
        if (!Number.isFinite(created) || +time - created >= retryWindowMs) return response(409, "reconciliation_required");
        if (!Number.isFinite(leaseExpiry) || leaseExpiry > +time) return response(409, "attempt_in_progress");
        stage = "saved_payload";
        payload = payloadSchema.parse(existing.payload);
        if (payload.from !== from || payload.to[0] !== to) return response(409, "reconciliation_required");
        stage = "claim";
        if (!await store.reclaim(key, token, time.toISOString(), new Date(+time + leaseMs).toISOString(),
          new Date(+time - retryWindowMs).toISOString())) return response(409, "claim_not_acquired");
      } else {
        payload = payloadSchema.parse({ ...(await buildReport()), from, to: [to] });
        stage = "claim";
        if (!await store.claim({ week_start: key, attempt_token: token,
          lease_until: new Date(+now() + leaseMs).toISOString(), payload })) return response(409, "claim_not_acquired");
      }

      stage = "provider";
      let providerId: string;
      try {
        const sent = await fetcher("https://api.resend.com/emails", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json",
            "Idempotency-Key": `careermind-beta-scorecard/${key}`,
          },
          // Explicit order also keeps the wire representation stable after JSONB storage.
          body: JSON.stringify({ from: payload.from, to: payload.to, subject: payload.subject, html: payload.html, text: payload.text }),
        });
        if (!sent.ok) throw new Error("Provider did not confirm acceptance");
        providerId = z.object({ id: z.uuid() }).parse(await sent.json()).id;
      } catch {
        // No HTTP error or timeout is treated as proof that no email was sent.
        warn({ event: "beta_scorecard_failed", week_start: key, stage });
        stage = "record_uncertain";
        await store.finish(key, token, null);
        return response(502, "provider_acceptance_uncertain");
      }
      stage = "record_acceptance";
      await store.finish(key, token, providerId);
      return response(200, "accepted");
    } catch {
      warn({ event: "beta_scorecard_failed", week_start: key, stage });
      return response(503, "scorecard_unavailable");
    }
  };
}
