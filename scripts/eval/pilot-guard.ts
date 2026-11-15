// Opt-in, evaluation-only transport guard. Estimates are operational controls,
// not a provider billing guarantee. No prompts or scoring are changed.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PILOT_LIMITS = {
  scenarios: 5, runs: 1, agentTurns: 8, agentCalls: 35, judgeCalls: 200,
  agentBytes: 65536, judgeBytes: 16384, agentOutput: 4096, judgeOutput: 1024,
  uploads: 5, margin: 1.5,
};
export class PilotGuard {
  stopped: string | null = null;
  agentCalls = 0; judgeCalls = 0; uploads = 0;
  reservedUsd = 0; estimatedUsd = 0;
  receipts: Array<{ model: string; input: number; output: number; estimatedUsd: number; latencyMs: number; responseId?: string; rawOutput?: unknown }> = [];
  private scenarioCalls = 0;
  private scenarios = new Set<string>();
  reportPath?: string;
  constructor(readonly resumeBytes: number, readonly threshold = 5) {
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 5) throw Error("Pilot threshold must be > 0 and <= $5");
    if (!Number.isSafeInteger(resumeBytes) || resumeBytes < 0 || resumeBytes > 2048) throw Error("Pilot requires synthetic text fixtures <= 2048 bytes");
    if (this.maximumUsd() >= threshold) throw Error(`Worst-case estimate $${this.maximumUsd().toFixed(4)} is not below threshold`);
  }
  cost(model: string, input: number, output: number) {
    if (model === "gpt-6-luna") return (input * 0.1 + output * 0.5) / 1e6;
    if (model === "gpt-4.1-mini") return (input * 0.4 + output * 1.6) / 1e6;
    throw Error("Unapproved pilot model");
  }
  bound(model: string) {
    const agent = model === "gpt-6-luna";
    // Byte upper bound for text tokens, plus file bytes and framing/schema slack.
    return this.cost(model, (agent ? PILOT_LIMITS.agentBytes : PILOT_LIMITS.judgeBytes) + this.resumeBytes + 4096,
      agent ? PILOT_LIMITS.agentOutput : PILOT_LIMITS.judgeOutput) * PILOT_LIMITS.margin;
  }
  maximumUsd() {
    // Uploads have no generation charge; reserve an extra cent per upload anyway.
    return PILOT_LIMITS.agentCalls * this.bound("gpt-6-luna") + PILOT_LIMITS.judgeCalls * this.bound("gpt-4.1-mini") + PILOT_LIMITS.uploads * 0.01;
  }
  assertHealthy() { if (this.stopped) throw Error(this.stopped); }
  stop(reason: string): never { this.stopped = reason; this.save(); throw Error(reason); }
  beginScenario(id: string) {
    this.assertHealthy();
    if (this.scenarios.has(id) || this.scenarios.size >= PILOT_LIMITS.scenarios) this.stop("Pilot scenario/run limit");
    this.scenarios.add(id); this.scenarioCalls = 0;
  }
  save() {
    if (this.reportPath) writeFileSync(this.reportPath, JSON.stringify({ limits: PILOT_LIMITS, thresholdUsd: this.threshold,
      maximumEstimatedUsd: this.maximumUsd(), reservedUsd: this.reservedUsd, estimatedUsd: this.estimatedUsd,
      agentCalls: this.agentCalls, judgeCalls: this.judgeCalls, uploads: this.uploads, stopped: this.stopped, receipts: this.receipts }, null, 2));
  }
  checkScenario(outcome: { harness_errors: string[] }) {
    // Save partial progress even when a transport failure has already tripped
    // the guard. Preserve that original stop reason instead of replacing it.
    if (this.stopped || outcome.harness_errors.length) {
      if (this.reportPath) writeFileSync(join(dirname(this.reportPath), "interrupted-outcome.json"), JSON.stringify(outcome, null, 2));
      this.assertHealthy();
      this.stop(`Pilot agent compatibility/harness error: ${outcome.harness_errors.join("\n")}`);
    }
  }
  wrap(fetcher: typeof fetch): typeof fetch {
    const guarded: typeof fetch = async (url, init) => {
      this.assertHealthy();
      const target = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      if (target.origin !== "https://api.openai.com") this.stop("Pilot blocks non-OpenAI network access");
      const method = init?.method ?? "GET";
      if (Number(new Headers(init?.headers).get("x-stainless-retry-count") ?? 0) !== 0) this.stop("Pilot blocks automatic retries");
      let model = "", reservation = 0, outputCap = 0;
      if (method === "POST" && target.pathname === "/v1/responses") {
        if (typeof init?.body !== "string") this.stop("Uninspectable evaluation request");
        const body = JSON.parse(init.body);
        model = body.model;
        if (!["gpt-6-luna", "gpt-4.1-mini"].includes(model)) this.stop("Unapproved pilot model");
        const agent = model === "gpt-6-luna";
        if (agent && body.reasoning?.effort !== "none") this.stop("Pilot requires reasoning none");
        if (body.tools?.length || body.stream || body.background || body.previous_response_id || body.conversation || body.service_tier && body.service_tier !== "default") this.stop("Unsupported pilot request options");
        outputCap = agent ? PILOT_LIMITS.agentOutput : PILOT_LIMITS.judgeOutput;
        body.max_output_tokens = Math.min(body.max_output_tokens ?? outputCap, outputCap);
        body.service_tier = "default";
        const serialized = JSON.stringify(body);
        if (Buffer.byteLength(serialized) > (agent ? PILOT_LIMITS.agentBytes : PILOT_LIMITS.judgeBytes)) this.stop("Pilot input byte limit");
        if (!this.scenarios.size) this.stop("Pilot scenario not started");
        if (agent) {
          if (++this.agentCalls > PILOT_LIMITS.agentCalls || ++this.scenarioCalls > PILOT_LIMITS.agentTurns) this.stop("Pilot agent turn limit");
        } else if (++this.judgeCalls > PILOT_LIMITS.judgeCalls) this.stop("Pilot judge call limit");
        reservation = this.bound(model);
        init = { ...init, body: serialized };
      } else if (method === "POST" && target.pathname === "/v1/files") {
        const file = init?.body instanceof FormData ? init.body.get("file") : null;
        if (!(file instanceof Blob) || file.size > this.resumeBytes || file.type !== "text/plain" || (init!.body as FormData).get("purpose") !== "user_data" || ++this.uploads > PILOT_LIMITS.uploads) this.stop("Pilot upload limit");
        reservation = 0.01;
      } else if (!(method === "GET" && /^\/v1\/models\/(gpt-6-luna|gpt-4\.1-mini)$/.test(target.pathname))) this.stop("Unapproved pilot API endpoint");
      if (this.reservedUsd + reservation > this.threshold) this.stop("Pilot spending threshold");
      // Retain reservations even on ambiguous failures; never refund and retry.
      this.reservedUsd += reservation; this.save();
      const started = performance.now();
      try {
        const response = await fetcher(url, { ...init, redirect: "error" });
        if (!response.ok) this.stop(`Pilot provider HTTP ${response.status} at ${target.pathname}`);
        if (model) {
          const receipt = await response.clone().json();
          const input = receipt.usage?.input_tokens, output = receipt.usage?.output_tokens;
          if (receipt.status !== "completed" || !Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0 || output > outputCap) this.stop("Incomplete or invalid provider receipt");
          const cost = this.cost(model, input, output);
          if (cost * PILOT_LIMITS.margin > reservation) this.stop("Provider usage exceeded conservative reservation");
          this.estimatedUsd += cost;
          this.receipts.push({ model, input, output, estimatedUsd: cost, latencyMs: performance.now() - started, responseId: receipt.id, rawOutput: receipt.output });
          this.save();
        }
        return response;
      } catch (error) {
        if (this.stopped) throw error;
        this.stop("Pilot network/provider error; no further requests permitted");
      }
    };
    // SDK multipart detection accepts this constructor instead of fetch(data:,).
    return Object.assign(guarded, { Response });
  }
}
export let activePilot: PilotGuard | undefined;
export function installPilot(guard: PilotGuard) {
  if (activePilot) throw Error("Pilot already installed");
  activePilot = guard; globalThis.fetch = guard.wrap(globalThis.fetch);
}
