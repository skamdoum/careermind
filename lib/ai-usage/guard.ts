import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { usageRPC } from "./store.server";
import { providerContext as context, AIUsageError } from "./provider";
import type { Route, Operation } from "./provider";
export { aiResponse, aiFile, AIUsageError } from "./provider";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const usageMessages: Record<string, string> = {
    AI_DAILY_LIMIT: "You have reached today's AI limit. Try again after midnight UTC.",
    AI_BURST_LIMIT: "Too many AI requests. Try again in a minute.",
    AI_IN_PROGRESS: "An AI request is already running. Wait a moment and try again.",
    AI_BUDGET_LIMIT: "CareerMind's daily AI allowance is temporarily unavailable. Please try again later.",
    AI_RECOVERY_REQUIRED: "Retry your previous AI request to finish saving its result before starting another.",
    AI_OUTCOME_UNCERTAIN: "The previous AI request's outcome could not be confirmed. Contact support before starting another AI request.",
    AI_DISABLED: "AI generation is temporarily paused. Saved results are still available.",
    AI_USAGE_UNAVAILABLE: "AI generation is temporarily unavailable. Your saved data has been kept. Please try again later.",
    AI_PROVIDER_REJECTED: "The AI provider could not process this input. Please check the resume and try again.",
    AI_PROVIDER_LIMIT: "The AI provider is temporarily unavailable. Please try again later.",
};
export function usageErrorResponse(error: unknown) {
    if (!(error instanceof AIUsageError))
        return null;
    return NextResponse.json({ success: false, error: usageMessages[error.code] ?? (error.status === 413 ? "This request is too large to process safely. Reduce the input and try again." : "AI request unavailable"), data: { code: error.code, retry_after_seconds: error.retryAfter } }, {
        status: error.status, headers: { "Cache-Control": "private, no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
    });
}
async function rpc(name: string, args: Record<string, unknown>) {
    try {
        return await usageRPC(name, args);
    }
    catch {
        throw new AIUsageError(503, "AI_USAGE_UNAVAILABLE", 30);
    }
}
export async function withAIUsage(options: {
    userId: string;
    route: Route;
    input: unknown;
    request?: Request;
    units?: number;
}, work: () => Promise<Response>): Promise<Response> {
    const supplied = options.request?.headers.get("Idempotency-Key");
    if (supplied && (supplied.length > 128 || !/^[A-Za-z0-9_-]+$/.test(supplied)))
        throw new AIUsageError(400, "AI_INVALID_REQUEST_KEY");
    const fingerprint = hash(["beta-ai-usage-v1", options.route, options.input]);
    const key = hash([options.route, supplied ?? fingerprint]);
    const claimed = await rpc("ai_usage_claim", { p_user: options.userId, p_key: key, p_hash: fingerprint, p_route: options.route, p_units: options.units ?? 1 }) as {
        operation?: Operation;
        replay?: {
            status: number;
            body: unknown;
        };
        status?: number;
        code?: string;
        retry_after?: number;
    };
    if (claimed.replay)
        return NextResponse.json(claimed.replay.body, { status: claimed.replay.status, headers: { "Cache-Control": "private, no-store" } });
    if (!claimed.operation)
        throw new AIUsageError(claimed.status ?? 503, claimed.code ?? "AI_USAGE_UNAVAILABLE", claimed.retry_after ?? 0);
    const op = claimed.operation;
    return context.run({ op, call: 0, upload: 0, providerError: false, step }, async () => {
        try {
            const response = await work();
            response.headers.set("Cache-Control", "private, no-store");
            const body = await response.clone().json();
            await rpc("ai_usage_end", { p_id: op.id, p_owner: op.owner, p_result: { status: response.status, body }, p_retry: false });
            return response;
        }
        catch (error) {
            const limited = usageErrorResponse(error);
            const status = limited?.status ?? (typeof (error as {
                status?: unknown;
            })?.status === "number" && Number((error as {
                status: number;
            }).status) >= 400 && Number((error as {
                status: number;
            }).status) <= 599 ? Number((error as {
                status: number;
            }).status) : options.route === "recommendation" ? 503 : 500);
            const message = error instanceof Error ? error.message : "AI operation failed";
            const assessmentCode = (error as {
                code?: unknown;
            })?.code;
            const body = limited ? await limited.clone().json() : options.route === "recommendation"
                ? (typeof assessmentCode === "string" ? { success: false, error: assessmentCode, message } : { success: false, error: "assessment_unavailable", message: "The assessment is unavailable. Please try again later." })
                : { success: false, error: options.route === "compare" && status === 500 ? "Compare failed" : message };
            try {
                await rpc("ai_usage_end", { p_id: op.id, p_owner: op.owner, p_result: { status, body }, p_retry: !context.getStore()!.providerError && (error instanceof AIUsageError ? error.code === "AI_USAGE_UNAVAILABLE" : !(error instanceof SyntaxError) && (!(error as {
                        status?: unknown;
                    })?.status || Number((error as {
                        status: number;
                    }).status) >= 500)) });
            }
            catch { /* Lost accounting writes fail closed: pending holds are not refunded. */ }
            return limited ?? NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
        }
    });
}
async function step(action: string, key: string, value: unknown = null) {
    const c = context.getStore();
    if (!c)
        throw new AIUsageError(503, "AI_OPERATION_REQUIRED");
    const result = await rpc("ai_usage_step", { p_id: c.op.id, p_owner: c.op.owner, p_action: action, p_key: key, p_value: value });
    if (action !== "read" && action !== "begin")
        c.op.steps[key] = result;
    return result;
}
export async function usageCheckpoint<T>(key: string, read: () => Promise<T>): Promise<T> {
    const c = context.getStore();
    if (!c)
        return read();
    if (Object.hasOwn(c.op.steps, key))
        return c.op.steps[key] as T;
    return await step("save", key, await read()) as T;
}
export async function persistAIRecords<T>(kind: string, data: unknown): Promise<T> {
    const c = context.getStore();
    if (!c)
        throw new AIUsageError(503, "AI_OPERATION_REQUIRED");
    return await rpc("ai_usage_persist", { p_id: c.op.id, p_owner: c.op.owner, p_kind: kind, p_data: data }) as T;
}
export function hasUsageContext() { return !!context.getStore(); }
export async function readAIInput(req: Request): Promise<Record<string, unknown>> {
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
        throw new AIUsageError(415, "AI_JSON_REQUIRED");
    const reader = req.body?.getReader();
    if (!reader)
        throw new AIUsageError(400, "AI_INVALID_INPUT");
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > 512 * 1024) {
                void reader.cancel().catch(() => { });
                throw new AIUsageError(413, "AI_INPUT_TOO_LARGE");
            }
            parts.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    let body: unknown;
    try {
        body = JSON.parse(Buffer.concat(parts).toString("utf8"));
    }
    catch {
        throw new AIUsageError(400, "AI_INVALID_INPUT");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
        throw new AIUsageError(400, "AI_INVALID_INPUT");
    return body as Record<string, unknown>;
}
