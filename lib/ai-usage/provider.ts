import { AsyncLocalStorage } from "node:async_hooks";
import type OpenAI from "openai";
import { recordProviderMeasurement, type TelemetryScope } from "./telemetry";
export type Route = "analysis" | "compare" | "kickoff" | "turn" | "recommendation" | "insights" | "strategy";
export type Operation = {
    id: string;
    owner: string;
    steps: Record<string, unknown>;
};
export type Context = {
    op: Operation;
    call: number;
    upload: number;
    providerError: boolean;
    userId?: string;
    telemetry?: TelemetryScope;
    step: (action: string, key: string, value?: unknown) => Promise<unknown>;
};
export const providerContext = new AsyncLocalStorage<Context>();
const outputCaps: Record<Route, number> = { analysis: 8192, compare: 1536, kickoff: 4096, turn: 4096, recommendation: 2400, insights: 800, strategy: 1600 };
export class AIUsageError extends Error {
    constructor(public status: number, public code: string, public retryAfter = 0) { super(code); }
}
export async function aiResponse(client: OpenAI, params: OpenAI.Responses.ResponseCreateParamsNonStreaming, route: Route, unmeteredEvaluation = false) {
    if (Buffer.byteLength(JSON.stringify(params.input), "utf8") > 512 * 1024)
        throw new AIUsageError(413, "AI_CONTEXT_TOO_LARGE");
    const c = providerContext.getStore();
    // Standalone evaluation scripts remain outside application accounting.
    if (!c && !unmeteredEvaluation)
        throw new AIUsageError(503, "AI_OPERATION_REQUIRED");
    if (!c)
        return client.responses.create({ ...params, max_output_tokens: outputCaps[route] }, { maxRetries: 0, timeout: 60000 });
    const callIndex = c.call;
    const key = `response:${c.call++}`;
    if (Object.hasOwn(c.op.steps, key))
        return c.op.steps[key] as OpenAI.Responses.Response;
    await c.step("begin", key);
    const started = performance.now();
    let response: OpenAI.Responses.Response;
    try {
        response = await client.responses.create({ ...params, max_output_tokens: outputCaps[route] }, { maxRetries: 0, timeout: 60000, headers: { "X-Client-Request-Id": `${c.op.id}-${key}` } });
    }
    catch (error) {
        c.providerError = true;
        const status = Number((error as {
            status?: number;
        })?.status);
        if (c.userId) await recordProviderMeasurement({
            operationId: c.op.id, callIndex, userId: c.userId, route, scope: c.telemetry,
            latencyMs: performance.now() - started, model: params.model ?? "unknown",
            outcome: [400, 401, 403, 404, 413, 422, 429].includes(status) ? "rejected" : "unknown",
        });
        if ([400, 401, 403, 404, 413, 422, 429].includes(status)) {
            await c.step("rejected", key, { rejected: true, status });
            throw new AIUsageError(status === 429 ? 503 : status, status === 429 ? "AI_PROVIDER_LIMIT" : "AI_PROVIDER_REJECTED", status === 429 ? 30 : 0);
        }
        throw error;
    } // Network errors, timeouts and server errors remain ambiguous, not refunds.
    const saved = { request_id: (response as OpenAI.Responses.Response & {
            _request_id?: string;
        })._request_id, id: response.id, model: response.model, output_text: response.output_text, usage: response.usage };
    const latencyMs = performance.now() - started;
    try {
        await c.step("response", key, saved);
    } finally {
        // Preserve the provider measurement even if accounting persistence fails.
        // Telemetry is never a reason to repeat the provider call.
        if (c.userId) await recordProviderMeasurement({
            operationId: c.op.id, callIndex, userId: c.userId, route, scope: c.telemetry,
            latencyMs, model: response.model, responseId: response.id, usage: response.usage,
            outcome: response.status && response.status !== "completed" ? "incomplete" : "success",
        });
    }
    return response;
}
export async function aiFile(client: OpenAI, file: File) {
    if (file.size > 5 * 1024 * 1024)
        throw new AIUsageError(413, "AI_FILE_TOO_LARGE");
    const c = providerContext.getStore();
    if (!c)
        throw new AIUsageError(503, "AI_OPERATION_REQUIRED");
    const key = `file:${c.upload++}`;
    if (c && Object.hasOwn(c.op.steps, key))
        return c.op.steps[key] as OpenAI.Files.FileObject;
    const result = await client.files.create({ file, purpose: "user_data" }, { maxRetries: 0, timeout: 60000 });
    if (c)
        await c.step("save", key, result);
    return result;
}
