-- Add free-text description to career_goals. Additive, nullable, no backfill.

begin;

alter table public.career_goals
  add column if not exists description text;

commit;
