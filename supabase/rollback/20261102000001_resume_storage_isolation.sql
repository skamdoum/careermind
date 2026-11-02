-- Emergency fail-closed rollback. NEVER restore the old bucket-wide policies.
-- Browser resume access stops; trusted service-role operations keep working.
begin;

create policy resumes_client_access_disabled on storage.objects
  as restrictive for all to public
  using (bucket_id <> 'resumes')
  with check (bucket_id <> 'resumes');

drop policy resumes_owner_select on storage.objects;
drop policy resumes_owner_insert on storage.objects;
drop policy resumes_owner_update on storage.objects;
drop policy resumes_owner_delete on storage.objects;

commit;
