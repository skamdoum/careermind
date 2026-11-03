import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// Explicit opt-in to a development project; no policy changes or migrations here.
loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const project = process.env.CAREERMIND_STORAGE_TEST_PROJECT_REF;
assert.ok(project, "Set CAREERMIND_STORAGE_TEST_PROJECT_REF to the confirmed development project");
assert.equal(new URL(url).hostname, `${project}.supabase.co`);
const origin = new URL(process.env.CAREERMIND_STORAGE_TEST_BASE_URL ?? "http://127.0.0.1:3107");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "App smoke tests must target loopback");
const authOptions = { persistSession: false, autoRefreshToken: false };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: authOptions });
const anonymous = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: authOptions });
const run = randomUUID();
type TestUser = { id: string; cookies: Map<string, string>; client: SupabaseClient; profile?: string };
const users: TestUser[] = [];
const objects: string[] = [];
let passed = 0;
let failed = false;
let cleanupFailed = false;
function checked<T extends { data: unknown; error: unknown }>(result: T, context: string): T["data"] {
  assert.equal(result.error, null, context);
  return result.data;
}
async function step(name: string, work: () => Promise<void>) {
  await work(); passed++; console.log(JSON.stringify({ check: name, result: "PASS" }));
}
async function api(user: TestUser, path: string, body?: unknown) {
  const r = await fetch(new URL(path, origin), {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie: [...user.cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  assert.equal(r.status, 200, `${path} returned ${r.status}`);
  const data = await r.json(); assert.equal(data.success, true); return data;
}
async function newUser(label: string) {
  const email = `storage-smoke-${run}-${label}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { purpose: "development-storage-isolation-smoke", run } }), "create disposable Auth user");
  assert.ok(created.user);
  const cookies = new Map<string, string>();
  const user: TestUser = { id: created.user.id, cookies, client: createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)) }, auth: { autoRefreshToken: false },
  }) };
  users.push(user);
  const signed = checked(await user.client.auth.signInWithPassword({ email, password }), "registered sign-in");
  assert.equal(signed.user?.id, user.id); assert.equal(signed.user?.is_anonymous, false);
  // Independently verify the JWT identity used for direct Storage requests.
  const verified = checked(await user.client.auth.getUser(), "verify test identity"); assert.equal(verified.user?.id, user.id);
  await api(user, "/api/profile/ensure", {});
  const profile = checked(await user.client.from("profiles").select("active_career_profile_id").eq("id", user.id).single(), "read active profile");
  assert.ok(profile);
  user.profile = profile.active_career_profile_id; assert.ok(user.profile);
  return user;
}
const content = (label: string) => Buffer.from(`SYNTHETIC RESUME TEST FIXTURE ${run} ${label}. Not a real person. Fictional PM experience only.\n`);
function path(user: TestUser, suffix = ".txt") {
  const result = `${user.id}/${Date.now()}${suffix}`; objects.push(result); return result;
}
function download(client: SupabaseClient, key: string, fresh = false) {
  // no-store alone does not bypass an already populated CDN entry. The SDK's
  // documented cacheNonce also requests a new origin lookup for this object.
  return client.storage.from("resumes").download(key, fresh ? { cacheNonce: randomUUID() } : undefined,
    fresh ? { cache: "no-store" } : undefined);
}
async function bytes(client: SupabaseClient, key: string, fresh = false) {
  const blob = checked(await download(client, key, fresh), "download synthetic object");
  assert.ok(blob); return Buffer.from(await blob.arrayBuffer());
}
async function noDownload(client: SupabaseClient, key: string) {
  const r = await download(client, key);
  assert.ok(r.error, "Unauthorized download unexpectedly succeeded"); assert.equal(r.data, null, "Unauthorized request obtained file content");
}
async function deletedObject(owner: TestUser, key: string) {
  const before = checked(await owner.client.storage.from("resumes").list(owner.id), "list before owner deletion");
  const object = before?.find(f => f.name === key.split("/")[1]); assert.ok(object?.id);
  const removed = checked(await owner.client.storage.from("resumes").remove([key]), "owner deletion");
  assert.ok(removed); assert.equal(removed.length, 1); assert.equal(removed[0].name, key); assert.equal(removed[0].id, object.id);
  const after = checked(await owner.client.storage.from("resumes").list(owner.id), "list after owner deletion");
  assert.ok(after); assert.ok(!after.some(f => f.id === object.id || f.name === object.name));
  // A new verified session/client rules out reuse of an SDK promise or stale
  // authentication. No sleep or eventual-success retries are used.
  const session = checked(await owner.client.auth.getSession(), "owner session").session; assert.ok(session);
  const fresh = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: authOptions });
  checked(await fresh.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }), "fresh owner session");
  assert.equal(checked(await fresh.auth.getUser(), "verify fresh owner").user?.id, owner.id);
  const result = await download(fresh, key, true);
  assert.ok(result.error, "Fresh owner request retrieved deleted contents"); assert.equal(result.data, null);
  assert.equal(result.error.message, "Object not found", "Deletion must fail as missing, not because the session is invalid");
}
async function main() {
  try {
    const bucket = checked(await admin.storage.getBucket("resumes"), "inspect resumes bucket"); assert.ok(bucket); assert.equal(bucket.public, false);
    let a!: TestUser, b!: TestUser, pa = "", pb = "";
    await step("two disposable registered users authenticate with distinct verified JWTs", async () => { a = await newUser("a"); b = await newUser("b"); assert.notEqual(a.id, b.id); });
    await step("both owners upload synthetic files and read back exact contents", async () => {
      pa = path(a); pb = path(b);
      checked(await a.client.storage.from("resumes").upload(pa, content("A"), { contentType: "text/plain", upsert: false }), "A upload");
      checked(await b.client.storage.from("resumes").upload(pb, content("B"), { contentType: "text/plain", upsert: false }), "B upload");
      assert.deepEqual(await bytes(a.client, pa), content("A")); assert.deepEqual(await bytes(b.client, pb), content("B"));
    });
    await step("application metadata registration and latest-resume reads retain exact user/profile association", async () => {
      for (const [u, key] of [[a, pa], [b, pb]] as const) {
        const saved = await api(u, "/api/resumes", { filePath: key, fileName: `Synthetic_Storage_${run}.txt`, mimeType: "text/plain" });
        assert.equal(saved.data.user_id, u.id); assert.equal(saved.data.career_profile_id, u.profile);
        const latest = await api(u, "/api/resumes/latest"); assert.equal(latest.data.id, saved.data.id); assert.equal(latest.data.file_path, key);
        const outsider = u === a ? b : a;
        assert.equal(checked(await outsider.client.from("resumes").select("id").eq("id", saved.data.id).maybeSingle(), "metadata isolation"), null);
      }
    });
    await step("cross-user downloads cannot return file contents in either direction", async () => { await noDownload(b.client, pa); await noDownload(a.client, pb); });
    await step("owner listing works; cross-user prefix and root listing do not expose foreign files", async () => {
      const own = checked(await a.client.storage.from("resumes").list(a.id), "owner listing"); assert.ok(own?.some(f => f.name === pa.split("/")[1]));
      const foreign = checked(await b.client.storage.from("resumes").list(a.id), "foreign listing"); assert.equal(foreign?.length, 0);
      const roots = checked(await b.client.storage.from("resumes").list(""), "root listing"); assert.ok(roots); assert.ok(!roots.some(f => f.name === a.id));
    });
    await step("cross-user new upload, overwrite and upsert fail; original bytes remain intact", async () => {
      const forged = path(a, "-forged.txt");
      for (const r of [await b.client.storage.from("resumes").upload(forged, content("bad")), await b.client.storage.from("resumes").update(pa, content("bad")), await b.client.storage.from("resumes").upload(pa, content("bad"), { upsert: true })]) assert.ok(r.error, "Foreign write was accepted");
      assert.deepEqual(await bytes(a.client, pa), content("A"));
      const list = checked(await a.client.storage.from("resumes").list(a.id), "verify foreign insertion denied"); assert.ok(list); assert.ok(!list.some(f => f.name === forged.split("/")[1]));
    });
    await step("cross-user delete removes nothing and cannot destroy the owner's contents", async () => {
      const r = checked(await b.client.storage.from("resumes").remove([pa]), "foreign delete response"); assert.equal(r?.length, 0);
      assert.deepEqual(await bytes(a.client, pa), content("A"));
    });
    await step("owner cannot move their object into another user's namespace", async () => {
      const destination = path(a, "-moved.txt"); const r = await b.client.storage.from("resumes").move(pb, destination);
      assert.ok(r.error, "Cross-namespace move was accepted"); assert.deepEqual(await bytes(b.client, pb), content("B"));
    });
    await step("unauthenticated download/list/upload/update/delete cannot expose or change contents", async () => {
      await noDownload(anonymous, pa);
      const list = checked(await anonymous.storage.from("resumes").list(a.id), "anonymous listing"); assert.equal(list?.length, 0);
      assert.ok((await anonymous.storage.from("resumes").upload(path(a, "-anonymous.txt"), content("bad"))).error);
      assert.ok((await anonymous.storage.from("resumes").update(pa, content("bad"))).error);
      const deleted = checked(await anonymous.storage.from("resumes").remove([pa]), "anonymous deletion"); assert.equal(deleted?.length, 0);
      assert.deepEqual(await bytes(a.client, pa), content("A"));
    });
    await step("owner can update and upsert their own file", async () => {
      checked(await a.client.storage.from("resumes").update(pa, content("A updated"), { contentType: "text/plain" }), "owner update"); assert.deepEqual(await bytes(a.client, pa, true), content("A updated"));
      checked(await a.client.storage.from("resumes").upload(pa, content("A"), { contentType: "text/plain", upsert: true }), "owner upsert"); assert.deepEqual(await bytes(a.client, pa, true), content("A"));
    });
    await step("service-role downloads required by analysis/investigation still read both synthetic objects", async () => { assert.deepEqual(await bytes(admin, pa), content("A")); assert.deepEqual(await bytes(admin, pb), content("B")); });
    await step("service-role upload and deletion still work", async () => {
      const key = path(a, "-service.txt"); checked(await admin.storage.from("resumes").upload(key, content("service")), "service upload"); assert.deepEqual(await bytes(admin, key), content("service"));
      const removed = checked(await admin.storage.from("resumes").remove([key]), "service deletion"); assert.ok(removed); assert.equal(removed.length, 1); assert.equal(removed[0].name, key);
      const result = await download(a.client, key, true); assert.ok(result.error); assert.equal(result.data, null);
    });
    await step("owner deletion removes the exact object; fresh authenticated origin requests cannot return contents", async () => {
      for (const [u, outsider, key] of [[a, b, pa], [b, a, pb]] as const) {
        await deletedObject(u, key);
        // Keep standard-URL authorization assertions too: cache bypass must not
        // hide an edge-layer cross-user leak.
        await noDownload(outsider.client, key);
        const result = await download(outsider.client, key, true); assert.ok(result.error); assert.equal(result.data, null);
      }
    });
  } catch (error) { failed = true; console.error(JSON.stringify({ result: "FAIL", message: error instanceof Error ? error.message : "Storage verification failed" })); }
  finally {
    // Cleanup is limited to UUIDs created during this run, including on failure.
    const errors: string[] = [];
    try { if (objects.length) checked(await admin.storage.from("resumes").remove(objects), "remove synthetic objects"); } catch { errors.push("synthetic objects"); }
    for (const u of users) {
      for (const [label, work] of [
        ["resume records", () => admin.from("resumes").delete().eq("user_id", u.id)],
        ["active pointer", () => admin.from("profiles").update({ active_career_profile_id: null }).eq("id", u.id)],
        ["career profiles", () => admin.from("career_profiles").delete().eq("user_id", u.id)],
        ["user profile", () => admin.from("profiles").delete().eq("id", u.id)],
        ["Auth user", () => admin.auth.admin.deleteUser(u.id)],
      ] as const) { try { checked(await work(), `cleanup ${label}`); } catch { errors.push(`${label} for ${u.id}`); } }
      try {
        const auth = await admin.auth.admin.getUserById(u.id); assert.equal(auth.error?.status, 404);
        for (const table of ["resumes", "career_profiles"]) { const r = await admin.from(table).select("id", { head: true, count: "exact" }).eq("user_id", u.id); checked(r, "verify no fixture rows"); assert.equal(r.count, 0); }
        assert.equal(checked(await admin.from("profiles").select("id").eq("id", u.id).maybeSingle(), "verify profile cleanup"), null);
        assert.equal(checked(await admin.storage.from("resumes").list(u.id), "verify object cleanup")?.length, 0);
      } catch { errors.push(`cleanup verification for ${u.id}`); }
    }
    cleanupFailed = errors.length > 0;
    console.log(JSON.stringify({ cleanup: cleanupFailed ? "FAIL" : "PASS", testUsers: users.length, errors, run }));
  }
  console.log(JSON.stringify({ passedChecks: passed, failed, cleanupFailed, existingResumeContentsRead: false, openAICalls: 0 }));
  if (failed || cleanupFailed) process.exitCode = 1;
}
void main();
