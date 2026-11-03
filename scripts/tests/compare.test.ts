import { usageStoreDouble } from "./usage-store-double";
/* eslint-disable @typescript-eslint/no-explicit-any -- Doubles replace network boundaries only; the production route and helpers run unchanged. */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import { COMPARE_LIMITS } from "../../lib/compare/input";

const require = createRequire(import.meta.url);
const USER = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const RESUME = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
let client: any, db: Record<string, any[]>, failTable: string | null;
let downloads: string[], uploads: File[], generations: any[], constructions: number;
let reads: Array<{ table: string; filters: Record<string, unknown> }>;
let storageFailure: boolean, providerFailure: boolean;
const load = (Module as any)._load;
(Module as any)._load = function(name: string, ...args: unknown[]) {
  if (/(?:ai-usage\/|\.\/)store\.server(?:\.ts)?$/.test(name)) return usageStoreDouble(()=>client);
  if (name === "server-only") return {};
  if (/lib\/supabase\/server(?:\.ts)?$/.test(name)) return { createClient: async () => client };
  if (/lib\/supabase\/admin(?:\.ts)?$/.test(name)) return { supabaseAdmin: { storage: { from: (bucket: string) => {
    assert.equal(bucket, "resumes");
    return { download: async (path: string) => { downloads.push(path); return storageFailure
      ? { data: null, error: { message: "secret storage detail" } }
      : { data: new Blob(["persisted resume bytes"], { type: "application/pdf" }), error: null }; } };
  } } } };
  if (name === "openai") return class {
    constructor() { constructions++; }
    files = { create: async ({ file, purpose }: any) => { uploads.push(file); assert.equal(purpose, "user_data"); return { id: "file-owned" }; } };
    responses = { create: async (input: any) => {
      generations.push(input);
      if (providerFailure) throw new Error("secret provider detail");
      return { output_text: JSON.stringify({ company_name: `Company ${generations.length}`, core_verdict: "Borderline", reasoning: "Existing reasoning", score: generations.length }) };
    } };
  };
  return load.call(this, name, ...args);
};
const { POST } = require("../../app/api/compare/route.ts");
(Module as any)._load = load;

function reset() {
  downloads = []; uploads = []; generations = []; reads = []; constructions = 0;
  failTable = null; storageFailure = false; providerFailure = false;
  db = {
    profiles: [{ id: USER, active_career_profile_id: PROFILE }],
    career_profiles: [{ id: PROFILE, user_id: USER }],
    resumes: [{ id: RESUME, user_id: USER, career_profile_id: PROFILE, file_path: `${USER}/historical.pdf`, file_name: "Original.pdf", mime_type: "application/pdf" }],
  };
  client = { auth: { getUser: async () => ({ data: { user: { id: USER, is_anonymous: false } }, error: null }) }, from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      maybeSingle: async () => {
        reads.push({ table, filters: { ...filters } });
        return { error: failTable === table ? { message: "secret database detail" } : null,
          data: failTable === table ? null : (db[table] ?? []).find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null };
      },
      // No writes or RPC interface: accidental profile creation or quota work fails.
    }; return q;
  } };
}
const payload = () => ({ resume_id: RESUME, jobDescriptions: ["Senior PM job requirements"] });
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/compare", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
async function denied(body: unknown, status: number) {
  const response = await POST(request(body));
  assert.equal(response.status, status);
  assert.equal((await response.json()).success, false);
  assert.deepEqual(downloads, []); assert.deepEqual(uploads, []); assert.deepEqual(generations, []); assert.equal(constructions, 0);
}

test("unauthenticated user is rejected before parsing or database access", async () => {
  reset(); client.auth.getUser = async () => ({ data: { user: null }, error: null });
  await denied(null, 401); assert.deepEqual(reads, []);
});
test("failed verified auth is rejected even if a user object is supplied", async () => {
  reset(); client.auth.getUser = async () => ({ data: { user: { id: USER } }, error: new Error("expired") });
  await denied(payload(), 401); assert.deepEqual(reads, []);
});
test("anonymous Auth user is rejected before database or AI work", async () => {
  reset(); client.auth.getUser = async () => ({ data: { user: { id: USER, is_anonymous: true } }, error: null });
  await denied(payload(), 403); assert.deepEqual(reads, []);
});
for (const field of ["user_id", "career_profile_id"]) test(`resume ${field} isolation`, async () => {
  reset(); db.resumes[0][field] = OTHER; await denied(payload(), 404);
  assert.deepEqual(reads.at(-1), { table: "resumes", filters: { id: RESUME, user_id: USER, career_profile_id: PROFILE } });
});
test("missing resume ID does not substitute a newer or primary resume", async () => {
  reset(); await denied({ ...payload(), resume_id: OTHER }, 404);
});
test("missing active profile never creates a fallback", async () => {
  reset(); db.profiles[0].active_career_profile_id = null; await denied(payload(), 403);
  assert.equal(reads.some(r => r.table === "resumes"), false);
});
test("foreign active-profile pointer is not trusted", async () => {
  reset(); db.career_profiles[0].user_id = OTHER; await denied(payload(), 403);
  assert.equal(reads.some(r => r.table === "resumes"), false);
});
test("forged request user/profile cannot authorize a foreign resume", async () => {
  reset(); db.resumes[0].user_id = OTHER;
  await denied({ ...payload(), user_id: OTHER, career_profile_id: PROFILE }, 404);
});
for (const path of [`${OTHER}/stolen.pdf`, `${USER}/../stolen.pdf`, `${USER}/%2e%2e/stolen.pdf`, `${USER}/x\\..\\stolen.pdf`, `${USER}//file.pdf`, `${USER}/file.pdf?download=1`, `${USER}/file.pdf#fragment`, "", null]) {
  test(`owned metadata cannot authorize an unsafe storage path (${JSON.stringify(path)})`, async () => {
    reset(); db.resumes[0].file_path = path; await denied(payload(), 403);
  });
}
const invalid: Array<[string, unknown, number]> = [
  ["null body", null, 400], ["array body", [], 400], ["primitive", "text", 400],
  ["missing jobs", { resume_id: RESUME }, 400], ["empty jobs", { ...payload(), jobDescriptions: [] }, 400],
  ["four jobs", { ...payload(), jobDescriptions: ["a", "b", "c", "d"] }, 400],
  ["string jobs", { ...payload(), jobDescriptions: "abc" }, 400],
  ["object jobs", { ...payload(), jobDescriptions: { length: 1 } }, 400],
  ["blank job", { ...payload(), jobDescriptions: [" "] }, 400],
  ["mixed job types", { ...payload(), jobDescriptions: ["valid", {}] }, 400],
  ["null job", { ...payload(), jobDescriptions: [null] }, 400],
  ["oversized job", { ...payload(), jobDescriptions: ["a".repeat(COMPARE_LIMITS.jobCharacters + 1)] }, 413],
  ["oversized text even with file", { ...payload(), resumeText: "a".repeat(COMPARE_LIMITS.resumeCharacters + 1) }, 413],
  ["invalid resume text", { ...payload(), resumeText: {} }, 400],
  ["blank resume", { resumeText: "   ", jobDescriptions: ["job"] }, 400],
  ["missing resume", { jobDescriptions: ["job"] }, 400],
  ["invalid resume ID", { ...payload(), resume_id: "../../secret" }, 400],
  ["null resume ID", { ...payload(), resume_id: null }, 400],
  ["invalid legacy ID", { latestResume: { id: {} }, jobDescriptions: ["job"] }, 400],
  ["path-only legacy request", { latestResume: { file_path: `${OTHER}/secret.pdf` }, jobDescriptions: ["job"] }, 400],
  ["path-only cannot fall through to text", { latestResume: { file_path: `${OTHER}/secret.pdf` }, resumeText: "text", jobDescriptions: ["job"] }, 400],
  ["invalid legacy reference", { latestResume: "path", resumeText: "text", jobDescriptions: ["job"] }, 400],
  ["conflicting IDs", { ...payload(), latestResume: { id: OTHER } }, 400],
];
for (const [name, body, status] of invalid) test(`invalid input: ${name}`, async () => { reset(); await denied(body, status); assert.deepEqual(reads, []); });
test("malformed JSON receives 400 with no privileged work", async () => {
  reset(); const response = await POST(new Request("http://localhost/api/compare", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
  assert.equal(response.status, 400); assert.deepEqual(downloads, []); assert.equal(constructions, 0);
});
test("unsupported content type receives 415", async () => {
  reset(); const response = await POST(request(payload(), { "content-type": "text/plain" }));
  assert.equal(response.status, 415); assert.deepEqual(downloads, []); assert.equal(constructions, 0);
});
test("actual body byte limit ignores a forged Content-Length and bounds multibyte input", async () => {
  reset(); const response = await POST(request({ ...payload(), padding: "é".repeat(COMPARE_LIMITS.bodyBytes / 2) }, { "content-length": "1" }));
  assert.equal(response.status, 413); assert.deepEqual(reads, []); assert.deepEqual(downloads, []); assert.equal(constructions, 0);
});
test("chunked request is bounded and canceled before database/provider work", async () => {
  reset(); let canceled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(64 * 1024)); }, cancel() { canceled = true; } });
  const req = new Request("http://localhost/api/compare", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  const response = await POST(req); assert.equal(response.status, 413); assert.equal(canceled, true);
  assert.deepEqual(reads, []); assert.deepEqual(downloads, []); assert.equal(constructions, 0);
});
test("unreadable request stream receives 400 without privileged work", async () => {
  reset(); const stream = new ReadableStream({ start(controller) { controller.error(new Error("broken stream")); } });
  const req = new Request("http://localhost/api/compare", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  const response = await POST(req); assert.equal(response.status, 400); assert.deepEqual(reads, []); assert.deepEqual(downloads, []); assert.equal(constructions, 0);
});
for (const count of [1, 2, 3]) test(`authorized ${count}-job comparison preserves response contract and descending scores`, async () => {
  reset(); const before = JSON.stringify(db);
  const response = await POST(request({ ...payload(), jobDescriptions: Array.from({ length: count }, (_, i) => `Job ${i + 1}`) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: Array.from({ length: count }, (_, i) => ({ company_name: `Company ${count - i}`, core_verdict: "Borderline", reasoning: "Existing reasoning", score: count - i })) });
  assert.deepEqual(downloads, [`${USER}/historical.pdf`]); assert.equal(uploads.length, 1); assert.equal(generations.length, count);
  assert.equal(uploads[0].name, "Original.pdf"); assert.equal(uploads[0].type, "application/pdf"); assert.equal(await uploads[0].text(), "persisted resume bytes");
  for (let i = 0; i < count; i++) {
    assert.equal(generations[i].model, "gpt-4.1"); assert.deepEqual(generations[i].input[1].content, [{ type: "input_file", file_id: "file-owned" }, { type: "input_text", text: `JOB DESCRIPTION:\nJob ${i + 1}` }]);
  }
  assert.equal(JSON.stringify(db), before);
});
test("legacy resume ID works but forged path/name/MIME cannot control file access", async () => {
  reset(); const response = await POST(request({ latestResume: { id: RESUME, file_path: `${OTHER}/stolen.pdf`, file_name: "forged.txt", mime_type: "text/plain" }, jobDescriptions: ["job"] }));
  assert.equal(response.status, 200); assert.deepEqual(downloads, [`${USER}/historical.pdf`]);
  assert.equal(uploads[0].name, "Original.pdf"); assert.equal(uploads[0].type, "application/pdf");
});
test("an explicit historical resume is used even after a newer primary resume was uploaded", async () => {
  reset(); db.resumes.push({ ...db.resumes[0], id: OTHER, file_path: `${USER}/new-primary.pdf`, is_primary: true, created_at: "2026-11-02" });
  const response = await POST(request(payload())); assert.equal(response.status, 200);
  assert.deepEqual(downloads, [`${USER}/historical.pdf`]); assert.equal(uploads[0].name, "Original.pdf");
});
test("file ID plus stale text uses the owned file as the canonical resume", async () => {
  reset(); const response = await POST(request({ ...payload(), resumeText: "stale candidate" }));
  assert.equal(response.status, 200); assert.ok(!JSON.stringify(generations).includes("stale candidate"));
});
test("authorized pasted-text fallback remains supported without storage or file upload", async () => {
  reset(); const response = await POST(request({ resumeText: "A candidate's PM experience", jobDescriptions: ["job"] }));
  assert.equal(response.status, 200); assert.deepEqual(downloads, []); assert.deepEqual(uploads, []); assert.equal(generations.length, 1);
  assert.deepEqual(generations[0].input[1].content[0], { type: "input_text", text: "RESUME TEXT FALLBACK:\nA candidate's PM experience" });
});
test("inclusive text limits accept a legitimate maximum-size comparison", async () => {
  reset(); const response = await POST(request({ resumeText: "a".repeat(COMPARE_LIMITS.resumeCharacters), jobDescriptions: Array(3).fill("b".repeat(COMPARE_LIMITS.jobCharacters)) }));
  assert.equal(response.status, 200); assert.equal(generations.length, 3);
});
for (const table of ["profiles", "career_profiles", "resumes"]) test(`${table} lookup failure fails closed`, async () => {
  reset(); failTable = table; await denied(payload(), table === "resumes" ? 503 : 500);
});
test("storage failure does not upload or invoke the model and hides internal details", async () => {
  reset(); storageFailure = true; const response = await POST(request(payload()));
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { success: false, error: "Compare failed" }); assert.equal(constructions, 0);
});
test("provider failure preserves the existing sanitized error contract", async () => {
  reset(); providerFailure = true; const response = await POST(request({ resumeText: "experience", jobDescriptions: ["job"] }));
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { success: false, error: "Compare failed" });
});
