import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { after, before, test } from "node:test";

// An isolated local Postgres cluster, never a configured/remote database. The
// production migration itself supplies every replacement authorization policy.
const root = mkdtempSync(join(tmpdir(), "careermind-storage-rls-"));
const data = join(root, "data");
const env = { ...process.env, PGHOST: root, PGPORT: "55471", PGUSER: "postgres", PGDATABASE: "postgres", PGPASSWORD: "" };
const migration = readFileSync(resolve("supabase/migrations/20261102000001_resume_storage_isolation.sql"), "utf8");
let started = false;
function command(binary: string, args: string[], input?: string) {
  const r = spawnSync(binary, args, { env, input, encoding: "utf8", timeout: 30_000 });
  if (r.error) throw r.error;
  return r;
}
function sql(query: string, succeeds = true) {
  const r = command("psql", ["-X", "-q", "-w", "-At", "--set", "ON_ERROR_STOP=1"], query);
  if (succeeds) assert.equal(r.status, 0, r.stderr);
  else assert.notEqual(r.status, 0, "Expected SQL to be denied");
  return r;
}
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
function asUser(id: string | null, query: string, succeeds = true, role = "authenticated") {
  return sql(`begin; set local role ${role}; set local request.jwt.claim.sub = '${id ?? ""}'; ${query}; rollback;`, succeeds);
}
const count = (r: ReturnType<typeof sql>) => Number(r.stdout.trim());

before(() => {
  const init = command("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"]);
  assert.equal(init.status, 0, init.stderr);
  const start = command("pg_ctl", ["-D", data, "-l", join(root, "server.log"), "-o", `-F -k ${root} -p 55471 -c listen_addresses=''`, "-w", "start"]);
  assert.equal(start.status, 0, start.stderr); started = true;
  sql(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
      declare parts text[]; begin parts := string_to_array(name, '/'); return parts[1:array_length(parts, 1) - 1]; end $$;
    create table storage.buckets (id text primary key, public boolean not null);
    insert into storage.buckets values ('resumes', false), ('unrelated', false);
    create table storage.objects (bucket_id text not null, name text not null, metadata text, primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema auth, storage to anon, authenticated, service_role;
    grant select,insert,update,delete on storage.objects to anon, authenticated, service_role;
    create policy "Authenticated users can upload resumes" on storage.objects for insert to authenticated with check (bucket_id = 'resumes');
    create policy "Authenticated users can view resumes" on storage.objects for select to authenticated using (bucket_id = 'resumes');
    create policy "Users can upload to their own resume folder" on storage.objects for insert to authenticated with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
    create policy "Users can view files in their own resume folder" on storage.objects for select to authenticated using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
    insert into storage.objects values ('resumes','${A}/a.pdf','synthetic A'),('resumes','${B}/b.pdf','synthetic B'),('unrelated','${A}/other.pdf','unrelated bucket');
  `);
});
after(() => {
  if (started) command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(root, { recursive: true, force: true });
});

test("migration aborts atomically if any unreviewed policy exists", () => {
  sql("create policy unreviewed on storage.objects for all to authenticated using (true) with check (true)");
  assert.match(sql(migration, false).stderr, /differ from the audited baseline/);
  assert.equal(count(sql("select count(*) from pg_policies where schemaname='storage' and tablename='objects'")), 5);
  sql("drop policy unreviewed on storage.objects");
});
test("same-named policy expression drift also aborts without partial changes", () => {
  sql('alter policy "Authenticated users can view resumes" on storage.objects using (true)');
  assert.match(sql(migration, false).stderr, /differ from the audited baseline/);
  assert.equal(count(sql("select count(*) from pg_policies where schemaname='storage' and tablename='objects'")), 4);
  sql('alter policy "Authenticated users can view resumes" on storage.objects using (bucket_id = \'resumes\')');
});
test("public bucket prerequisite fails closed", () => {
  sql("update storage.buckets set public=true where id='resumes'");
  assert.match(sql(migration, false).stderr, /existing private resumes bucket/);
  sql("update storage.buckets set public=false where id='resumes'");
});
test("disabled RLS prerequisite fails closed", () => {
  sql("alter table storage.objects disable row level security");
  assert.match(sql(migration, false).stderr, /RLS to remain enabled/);
  sql("alter table storage.objects enable row level security");
});
test("actual migration replaces all four unsafe/duplicated policies without changing objects", () => {
  sql(migration);
  assert.equal(sql("select string_agg(policyname,',' order by policyname) from pg_policies where schemaname='storage' and tablename='objects'").stdout.trim(), "resumes_owner_delete,resumes_owner_insert,resumes_owner_select,resumes_owner_update");
  assert.equal(count(sql("select count(*) from storage.objects")), 3);
  assert.equal(sql("select relrowsecurity from pg_class where oid='storage.objects'::regclass").stdout.trim(), "t");
});
for (const id of [A, B]) test(`owner can select, insert, update and delete only their namespace (${id})`, () => {
  assert.equal(count(asUser(id, "select count(*) from storage.objects")), 1);
  asUser(id, `insert into storage.objects values ('resumes','${id}/new.pdf','new')`);
  assert.equal(count(asUser(id, `with changed as (update storage.objects set metadata='updated' where name like '${id}/%' returning *) select count(*) from changed`)), 1);
  assert.equal(count(asUser(id, `with removed as (delete from storage.objects where name like '${id}/%' returning *) select count(*) from removed`)), 1);
});
test("cross-user listing and content metadata reads return no rows", () => {
  assert.equal(count(asUser(B, `select count(*) from storage.objects where name='${A}/a.pdf'`)), 0);
});
test("cross-user upload and upsert cannot insert or replace another user's object", () => {
  asUser(B, `insert into storage.objects values ('resumes','${A}/intruder.pdf','forged')`, false);
  asUser(B, `insert into storage.objects values ('resumes','${A}/a.pdf','forged') on conflict(bucket_id,name) do update set metadata=excluded.metadata`, false);
});
test("cross-user overwrite and deletion affect no rows", () => {
  assert.equal(count(asUser(B, `with changed as (update storage.objects set metadata='bad' where name='${A}/a.pdf' returning *) select count(*) from changed`)), 0);
  assert.equal(count(asUser(B, `with removed as (delete from storage.objects where name='${A}/a.pdf' returning *) select count(*) from removed`)), 0);
});
test("UPDATE checks the destination as well as the existing row", () => {
  asUser(A, `update storage.objects set name='${B}/moved.pdf' where name='${A}/a.pdf'`, false);
  asUser(A, `update storage.objects set bucket_id='unrelated' where name='${A}/a.pdf'`, false);
});
test("missing JWT identity and unauthenticated role cannot read or write", () => {
  for (const role of ["anon", "authenticated"]) {
    assert.equal(count(asUser(null, "select count(*) from storage.objects", true, role)), 0);
    asUser(null, `insert into storage.objects values ('resumes','${A}/anonymous.pdf','bad')`, false, role);
    assert.equal(count(asUser(null, "with removed as (delete from storage.objects returning *) select count(*) from removed", true, role)), 0);
  }
});
test("bucket-root paths do not qualify as an owner's namespace", () => {
  asUser(A, `insert into storage.objects values ('resumes','${A}','bad')`, false);
});
test("unrelated bucket contents and client access stay unchanged", () => {
  assert.equal(sql("select metadata from storage.objects where bucket_id='unrelated'").stdout.trim(), "unrelated bucket");
  assert.equal(count(asUser(A, "select count(*) from storage.objects where bucket_id='unrelated'")), 0);
  asUser(A, `insert into storage.objects values ('unrelated','${A}/new.pdf','bad')`, false);
});
test("service-role RLS bypass continues to support trusted server operations", () => {
  assert.equal(count(asUser(null, "select count(*) from storage.objects", true, "service_role")), 3);
  asUser(null, `insert into storage.objects values ('resumes','${A}/service.pdf','trusted')`, true, "service_role");
  assert.equal(count(asUser(null, "with removed as (delete from storage.objects where bucket_id='resumes' returning *) select count(*) from removed", true, "service_role")), 2);
});
test("emergency rollback disables client resumes access without changing data or service access", () => {
  sql(readFileSync(resolve("supabase/rollback/20261102000001_resume_storage_isolation.sql"), "utf8"));
  assert.equal(count(asUser(A, "select count(*) from storage.objects where bucket_id='resumes'")), 0);
  asUser(A, `insert into storage.objects values ('resumes','${A}/rollback.pdf','bad')`, false);
  assert.equal(count(asUser(null, "select count(*) from storage.objects", true, "service_role")), 3);
  assert.equal(count(sql("select count(*) from storage.objects")), 3);
});
test("fail-closed rollback cannot be defeated by a later permissive grant", () => {
  assert.equal(count(sql(`begin; create policy broad on storage.objects for all to authenticated using (true) with check (true);
    set local role authenticated; set local request.jwt.claim.sub='${A}'; select count(*) from storage.objects where bucket_id='resumes'; rollback;`)), 0);
});
