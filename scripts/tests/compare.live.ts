import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// Real Supabase Auth/Storage/data and actual local route; rejection paths only.
// Run the loopback app with compare-no-ai-preload.mjs before invoking this script.
loadEnvConfig(process.cwd());
const project = process.env.CAREERMIND_COMPARE_TEST_PROJECT_REF;
const audit = process.env.CAREERMIND_COMPARE_AUDIT_FILE;
assert.ok(project && audit, "Explicit test project and guarded-server audit file are required");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
assert.equal(new URL(url).hostname, `${project}.supabase.co`);
const origin = new URL(process.env.CAREERMIND_COMPARE_TEST_BASE_URL ?? "http://127.0.0.1:3108");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "Use the guarded loopback app only");
const auth = { persistSession: false, autoRefreshToken: false };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth });
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
type User = { id: string; client: SupabaseClient; cookies: Map<string, string>; profile?: string };
const users: User[] = [], objects: string[] = [];
const run = randomUUID();
let checks = 0, failed = false, cleanupFailed = false;
function checked<T extends { data: unknown; error: unknown }>(r: T, label: string): T["data"] { assert.equal(r.error, null, label); return r.data; }
function auditRows(): Array<{ event: string; method: string; pid: number }> {
  return readFileSync(audit!, "utf8").trim().split("\n").filter(Boolean).map(s => JSON.parse(s));
}
function noCostWork() {
  const rows = auditRows(); assert.ok(rows.some(r => r.event === "guard-loaded"), "Network guard was not loaded");
  assert.equal(rows.filter(r => r.event.startsWith("blocked-")).length, 0, "Route attempted forbidden Storage/provider work");
}
async function step(label: string, work: () => Promise<void>) {
  await work(); noCostWork(); checks++; console.log(JSON.stringify({ check: label, result: "PASS" }));
}
async function api(user: User | null, path: string, body?: unknown, raw?: string, contentType = "application/json") {
  const r = await fetch(new URL(path, origin), {
    method: body === undefined && raw === undefined ? "GET" : "POST",
    headers: { "content-type": contentType, ...(user ? { cookie: [...user.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
  });
  return { status: r.status, json: await r.json() };
}
async function rejected(user: User | null, body: unknown, status: number, raw?: string, contentType?: string) {
  const r = await api(user, "/api/compare", body, raw, contentType);
  assert.equal(r.status, status); assert.equal(r.json.success, false); assert.equal(typeof r.json.error, "string"); assert.ok(!("data" in r.json));
}
async function newUser(label: string) {
  const email = `compare-reject-${run}-${label}@example.com`, password = randomBytes(24).toString("base64url");
  const created = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { purpose: "compare-rejection-smoke", run } }), "create disposable user");
  assert.ok(created.user); const cookies = new Map<string, string>();
  const u: User = { id: created.user.id, cookies, client: createServerClient(url, key, {
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: rows => rows.forEach(({ name, value }) => cookies.set(name, value)) }, auth: { autoRefreshToken: false },
  }) }; users.push(u);
  const signed = checked(await u.client.auth.signInWithPassword({ email, password }), "sign in"); assert.ok(signed.user); assert.equal(signed.user.id, u.id); assert.equal(signed.user.is_anonymous, false);
  const ensure = await api(u, "/api/profile/ensure", {}); assert.equal(ensure.status, 200); assert.equal(ensure.json.success, true);
  const profile = checked(await u.client.from("profiles").select("active_career_profile_id").eq("id", u.id).single(), "active profile"); assert.ok(profile); u.profile = profile.active_career_profile_id; assert.ok(u.profile);
  return u;
}
async function upload(u: User, label: string) {
  const path = `${u.id}/${Date.now()}.txt`; objects.push(path);
  const content = `SYNTHETIC COMPARE TEST ${run} ${label}. Not a real person.`;
  checked(await u.client.storage.from("resumes").upload(path, content, { contentType: "text/plain", upsert: false }), "upload synthetic resume");
  const saved = await api(u, "/api/resumes", { filePath: path, fileName: `Synthetic_${label}.txt`, mimeType: "text/plain" });
  assert.equal(saved.status, 200); assert.equal(saved.json.success, true); assert.equal(saved.json.data.user_id, u.id); assert.equal(saved.json.data.career_profile_id, u.profile); assert.equal(saved.json.data.file_path, path);
  const blob = checked(await u.client.storage.from("resumes").download(path, { cacheNonce: randomUUID() }, { cache: "no-store" }), "owner synthetic download"); assert.ok(blob); assert.equal(await blob.text(), content);
  return saved.json.data as { id: string; file_path: string };
}
async function main() {
  try {
    noCostWork();
    let a!: User, b!: User, ra!: { id: string; file_path: string }, rb!: { id: string; file_path: string };
    const jobs = ["SYNTHETIC JOB: PM ownership and customer research"];
    await step("two disposable registered users authenticate through real Supabase", async () => { a = await newUser("a"); b = await newUser("b"); });
    await step("existing upload/metadata conventions and owned synthetic downloads remain compatible", async () => { ra = await upload(a, "A"); rb = await upload(b, "B"); });
    await step("a newer upload preserves historical record IDs and exact source paths", async () => {
      const newer = await upload(a, "A_newer"); assert.notEqual(newer.id, ra.id);
      const latest = await api(a, "/api/resumes/latest"); assert.equal(latest.status, 200); assert.equal(latest.json.data.id, newer.id);
      const old = checked(await a.client.from("resumes").select("file_path").eq("id", ra.id).single(), "historical source"); assert.ok(old); assert.equal(old.file_path, ra.file_path);
    });
    await step("unauthenticated Compare is rejected before privileged work (401)", () => rejected(null, { resume_id: ra.id, jobDescriptions: jobs }, 401));
    await step("cross-user resume IDs are rejected in both directions (404)", async () => {
      await rejected(a, { resume_id: rb.id, jobDescriptions: jobs }, 404);
      await rejected(b, { resume_id: ra.id, jobDescriptions: jobs }, 404);
    });
    await step("forged user/profile fields and pasted fallback cannot authorize a foreign resume", () => rejected(a, { resume_id: rb.id, user_id: b.id, career_profile_id: b.profile, resumeText: "synthetic fallback", jobDescriptions: jobs }, 404));
    await step("inactive-profile resume is rejected without fallback (404)", async () => {
      const cp = checked(await a.client.from("career_profiles").insert({ user_id: a.id, name: "Synthetic inactive search", is_default: false }).select("id").single(), "inactive profile"); assert.ok(cp);
      const r = checked(await a.client.from("resumes").insert({ user_id: a.id, career_profile_id: cp.id, file_path: ra.file_path, file_name: "Synthetic inactive.txt", mime_type: "text/plain", is_primary: false, version: 1 }).select("id").single(), "inactive resume"); assert.ok(r);
      await rejected(a, { resume_id: r.id, jobDescriptions: jobs }, 404);
    });
    await step("owned resume metadata cannot authorize another user's Storage path (403)", async () => {
      const r = await api(a, "/api/resumes", { filePath: rb.file_path, fileName: "Synthetic forged reference.txt", mimeType: "text/plain" }); assert.equal(r.status, 200);
      await rejected(a, { resume_id: r.json.data.id, jobDescriptions: jobs }, 403);
    });
    await step("path-only legacy requests cannot trigger downloads (400)", () => rejected(a, { latestResume: { file_path: rb.file_path }, jobDescriptions: jobs }, 400));
    await step("malformed and nonexistent resume IDs are rejected (400/404)", async () => {
      await rejected(a, { resume_id: "../forged", jobDescriptions: jobs }, 400);
      await rejected(a, { resume_id: randomUUID(), jobDescriptions: jobs }, 404);
    });
    await step("empty, excessive, mixed and malformed job arrays are rejected (400)", async () => {
      for (const jobDescriptions of [[], ["a", "b", "c", "d"], ["a", null], [" "], "not an array"]) await rejected(a, { resume_id: ra.id, jobDescriptions }, 400);
    });
    await step("oversized jobs, text and actual body bytes are rejected (413)", async () => {
      await rejected(a, { resume_id: ra.id, jobDescriptions: ["x".repeat(30001)] }, 413);
      await rejected(a, { resume_id: ra.id, jobDescriptions: jobs, resumeText: "x".repeat(60001) }, 413);
      await rejected(a, { resume_id: ra.id, jobDescriptions: jobs, padding: "x".repeat(512 * 1024) }, 413);
    });
    await step("invalid JSON and unsupported media are rejected (400/415)", async () => {
      await rejected(a, null, 400, "{"); await rejected(a, { resume_id: ra.id, jobDescriptions: jobs }, 415, undefined, "text/plain");
    });
    await step("missing active profile fails closed without creating a fallback (403)", async () => {
      checked(await a.client.from("profiles").update({ active_career_profile_id: null }).eq("id", a.id), "clear disposable pointer");
      try { await rejected(a, { resume_id: ra.id, jobDescriptions: jobs }, 403); }
      finally { checked(await a.client.from("profiles").update({ active_career_profile_id: a.profile }).eq("id", a.id), "restore pointer"); }
    });
    await step("real route made auth/database reads but attempted zero provider or Storage requests", async () => {
      assert.ok(auditRows().some(r => r.event === "allowed-auth-or-db" && r.method === "GET"), "Network guard did not observe the real route"); noCostWork();
    });
  } catch (e) { failed = true; console.error(JSON.stringify({ result: "FAIL", message: e instanceof Error ? e.message : "Compare integration failed" })); }
  finally {
    const errors: string[] = [];
    try { if (objects.length) checked(await admin.storage.from("resumes").remove(objects), "cleanup synthetic files"); } catch { errors.push("Storage cleanup"); }
    for (const u of users) {
      for (const [label, work] of [
        ["resumes", () => admin.from("resumes").delete().eq("user_id", u.id)],
        ["pointer", () => admin.from("profiles").update({ active_career_profile_id: null }).eq("id", u.id)],
        ["career profiles", () => admin.from("career_profiles").delete().eq("user_id", u.id)],
        ["profile", () => admin.from("profiles").delete().eq("id", u.id)],
        ["Auth", () => admin.auth.admin.deleteUser(u.id)],
      ] as const) { try { checked(await work(), `cleanup ${label}`); } catch { errors.push(`${label}:${u.id}`); } }
      try {
        assert.equal((await admin.auth.admin.getUserById(u.id)).error?.status, 404);
        for (const table of ["resumes", "career_profiles"]) { const r = await admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", u.id); checked(r, "verify fixture cleanup"); assert.equal(r.count, 0); }
        assert.equal(checked(await admin.from("profiles").select("id").eq("id", u.id).maybeSingle(), "verify user profile cleanup"), null);
        assert.equal(checked(await admin.storage.from("resumes").list(u.id), "verify file cleanup")?.length, 0);
      } catch { errors.push(`cleanup verification:${u.id}`); }
    }
    cleanupFailed = errors.length > 0;
    console.log(JSON.stringify({ cleanup: cleanupFailed ? "FAIL" : "PASS", users: users.length, syntheticFiles: objects.length, errors }));
  }
  console.log(JSON.stringify({ liveChecksPassed: checks, failed, cleanupFailed, apiOpenAIAndStorageAttempts: auditRows().filter(r => r.event.startsWith("blocked-")).length, paidOpenAICalls: 0, authorizedComparison: "not invoked: would require OpenAI", run }));
  if (failed || cleanupFailed) process.exitCode = 1;
}
void main();
