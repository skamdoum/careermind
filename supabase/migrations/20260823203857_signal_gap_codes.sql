-- Day 8.5+: Canonical signal / gap codes for cross-job aggregation.
-- Additive, idempotent, safe on populated DBs. Legacy rows carry NULL and
-- are still visible via the app-layer text-fallback bucket key.

begin;

alter table public.signal_assessments
  add column if not exists signal_code text;

alter table public.gaps
  add column if not exists gap_code text;

create index if not exists signal_assessments_signal_code_idx
  on public.signal_assessments (signal_code);

create index if not exists gaps_gap_code_idx
  on public.gaps (gap_code);

commit;
