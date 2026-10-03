-- Gap Investigation Agent — structured conclusion dimensions.
-- Replaces the single-label conclusion with four independent fields so the
-- UI can tell a candidate when the underlying capability is demonstrated
-- but the target-role-specific scope is not — the scope_mismatch case.
-- Additive and idempotent.

begin;

-- Loosen the conclusion CHECK to allow the new internal classification.
-- "scope_mismatch" is kept as a stored enum value (used by evaluation and
-- debugging) but is NOT the primary user-facing message — the UI renders
-- the four structured fields instead.
alter table public.gap_investigations
  drop constraint if exists gap_investigations_conclusion_check;

alter table public.gap_investigations
  add constraint gap_investigations_conclusion_check
    check (
      conclusion is null
      or conclusion in (
        'evidence_gap',
        'partial_evidence',
        'capability_gap',
        'scope_mismatch'
      )
    );

alter table public.gap_investigations
  add column if not exists underlying_capability text,
  add column if not exists resume_evidence text,
  add column if not exists target_role_fit text,
  add column if not exists residual_gap text;

alter table public.gap_investigations
  drop constraint if exists gap_investigations_underlying_capability_check;
alter table public.gap_investigations
  add constraint gap_investigations_underlying_capability_check
    check (
      underlying_capability is null
      or underlying_capability in ('demonstrated', 'partial', 'not_demonstrated')
    );

alter table public.gap_investigations
  drop constraint if exists gap_investigations_resume_evidence_check;
alter table public.gap_investigations
  add constraint gap_investigations_resume_evidence_check
    check (
      resume_evidence is null
      or resume_evidence in ('demonstrates', 'partial', 'does_not_demonstrate')
    );

alter table public.gap_investigations
  drop constraint if exists gap_investigations_target_role_fit_check;
alter table public.gap_investigations
  add constraint gap_investigations_target_role_fit_check
    check (
      target_role_fit is null
      or target_role_fit in ('meets', 'partial', 'does_not_meet')
    );

commit;
