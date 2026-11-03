-- Replace the audited bucket-wide grants; permissive policies combine with OR.
-- No object contents, metadata, other buckets, or service-role grants are changed.
begin;

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'Resume isolation requires storage.objects RLS to remain enabled';
  end if;
  if not exists (select 1 from storage.buckets where id = 'resumes' and not public) then
    raise exception 'Resume isolation requires the existing private resumes bucket';
  end if;

  -- Abort on drift rather than leave an unreviewed OR-policy bypass in place,
  -- or accidentally drop a policy serving another bucket. Compare all policies.
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects') <> 4
    or exists (
      select 1 from pg_policies p
      left join (values
        ('Authenticated users can upload resumes', 'INSERT', null,
          '(bucket_id = ''resumes''::text)'),
        ('Authenticated users can view resumes', 'SELECT',
          '(bucket_id = ''resumes''::text)', null),
        ('Users can upload to their own resume folder', 'INSERT', null,
          '((bucket_id = ''resumes''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))'),
        ('Users can view files in their own resume folder', 'SELECT',
          '((bucket_id = ''resumes''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))', null)
      ) expected(policyname, cmd, qual, with_check) on expected.policyname = p.policyname
      where p.schemaname = 'storage' and p.tablename = 'objects'
        and (expected.policyname is null or p.permissive <> 'PERMISSIVE'
          or p.roles <> array['authenticated']::name[] or p.cmd <> expected.cmd
          or p.qual is distinct from expected.qual or p.with_check is distinct from expected.with_check)
    ) then
    raise exception 'Storage policies differ from the audited baseline; review all policies before applying resume isolation';
  end if;
end $$;

drop policy "Authenticated users can upload resumes" on storage.objects;
drop policy "Authenticated users can view resumes" on storage.objects;
drop policy "Users can upload to their own resume folder" on storage.objects;
drop policy "Users can view files in their own resume folder" on storage.objects;

create policy resumes_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy resumes_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy resumes_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy resumes_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
