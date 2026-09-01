import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Card from "@/app/components/ui/Card";

/**
 * Landing page — final visual pass.
 *
 * Two chapters, hard color transition between them:
 *   1. DARK HERO CHAPTER (--color-brand-blue-deep #0F1B2D)
 *      Top nav + hero copy + primary CTA + cross-role preview +
 *      built-for line. Light preview cards contrast against the
 *      dark canvas — "research artifact on a dark desk."
 *   2. OFF-WHITE CANVAS (--color-page #FAFAF9)
 *      Value section ("The pattern is the strategy.") + minimal
 *      final CTA. No decorative divider — the color change itself
 *      signals the chapter break.
 *
 * The dark treatment is reserved to this one landing surface. Every
 * dashboard / app page stays on the light canvas by design.
 *
 * Server component so the primary CTA honors the user's session.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Logged-in → straight to Goals. Logged-out → login with a safe
  // internal-only `next` param so they land in the same place.
  const primaryCtaHref = user
    ? "/dashboard/goals"
    : "/login?next=%2Fdashboard%2Fgoals";
  const primaryHeroCtaLabel = user ? "Go to your dashboard" : "Start CareerMind";
  const compactNavCtaLabel = user ? "Dashboard" : "Start CareerMind";

  // Reusable text tone classes for the dark hero. Kept inline (rather
  // than promoted to tokens) because they only exist on this one page.
  //   #FFFFFF  → primary text on dark
  //   #CBD5E1  → secondary text on dark  (~11:1 contrast, AAA)
  //   #94A3B8  → muted text on dark      (~7:1 contrast, AAA)
  const DARK_PRIMARY_TEXT = "text-white";
  const DARK_SECONDARY_TEXT = "text-[#CBD5E1]";
  const DARK_MUTED_TEXT = "text-[#94A3B8]";

  return (
    <main className="min-h-screen bg-[color:var(--color-page)] text-[color:var(--color-text-primary)]">
      {/* ─────────────────────────────────────────────────────────
          CHAPTER 1 — Dark hero band. Full-width dark canvas.
          ───────────────────────────────────────────────────────── */}
      <section className="bg-[color:var(--color-brand-blue-deep)]">
        <div className="max-w-[72rem] w-full mx-auto px-6">
          {/* Top navigation — dark bar variant */}
          <div className="flex items-center justify-between py-5 border-b border-[#1E293B]">
            <Link
              href="/"
              className={`text-[15px] font-semibold tracking-[-0.01em] ${DARK_PRIMARY_TEXT}`}
            >
              CareerMind
            </Link>
            {/*
              Header CTA hierarchy:
                logged-out → "Sign in" text link + primary CTA chip
                logged-in  → single compact "Dashboard" CTA chip (no
                             duplicate text link)
            */}
            <div className="flex items-center gap-4 text-[13px]">
              {!user && (
                <Link
                  href="/login"
                  className={`${DARK_SECONDARY_TEXT} hover:text-white`}
                >
                  Sign in
                </Link>
              )}
              <Link
                href={primaryCtaHref}
                className="inline-flex items-center rounded-[6px] bg-white px-3 py-1.5 text-[13px] font-medium text-[color:var(--color-brand-blue-deep)] hover:opacity-90"
              >
                {compactNavCtaLabel}
              </Link>
            </div>
          </div>

          {/* Hero — 2-col on md+, single column with copy-first on mobile. */}
          <section className="grid gap-10 py-14 md:grid-cols-2 md:items-center md:gap-12">
            {/* Copy + CTA */}
            <div className="space-y-5">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${DARK_MUTED_TEXT}`}>
                For Product Managers targeting Senior and Principal roles
              </div>
              <h1 className={`text-[36px] md:text-[44px] font-semibold tracking-[-0.02em] leading-[1.1] ${DARK_PRIMARY_TEXT}`}>
                The career decision engine for Senior and Principal PMs.
              </h1>
              <p className={`text-[16px] leading-[1.6] max-w-xl ${DARK_SECONDARY_TEXT}`}>
                Most tools evaluate one resume against one job. CareerMind
                evaluates the roles you&apos;re actually targeting, finds what
                keeps recurring, and turns those patterns into a positioning
                strategy and prioritized action plan.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link
                  href={primaryCtaHref}
                  className="inline-flex items-center rounded-[6px] bg-white px-5 py-2.5 text-[14px] font-medium text-[color:var(--color-brand-blue-deep)] hover:opacity-90"
                >
                  {primaryHeroCtaLabel}
                </Link>
                {!user && (
                  <Link
                    href="/login"
                    className={`inline-flex items-center rounded-[6px] border border-[#334155] bg-transparent px-5 py-2.5 text-[14px] font-medium ${DARK_SECONDARY_TEXT} hover:bg-white/5`}
                  >
                    Sign in
                  </Link>
                )}
              </div>
              <p className={`text-[13px] pt-1 ${DARK_MUTED_TEXT}`}>
                Built for Product Managers targeting Senior and Principal roles.
              </p>
            </div>

            {/*
              Cross-role intelligence preview — light research artifact
              on a dark desk. Cards are the existing shared primitives;
              zero decoration added.

              Color meaning:
                - blue-tint  → Coaching Insight
                - neutral    → recurring strength / gap rows
                - warm       → Recommended Focus (the endpoint)

              Deliberately does NOT show a verdict — the differentiation
              being communicated is cross-role aggregation, not
              single-role evaluation.
            */}
            <div aria-hidden="true" className="space-y-4">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${DARK_MUTED_TEXT}`}>
                Based on 4 target-role analyses
              </div>

              <Card intent="info" padding="lg">
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80 mb-2">
                  Coaching insight
                </div>
                <p className="text-[15px] leading-[1.6] text-[color:var(--color-text-primary)]">
                  Your strongest recurring signal is cross-functional execution.
                  Strategy ownership appears as a gap across 3 of 4 target
                  roles, making it the highest-leverage area to strengthen.
                </p>
              </Card>

              {/* Recurring strength + gap — single divided card, no color surface. */}
              <div className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-border-subtle)] overflow-hidden">
                <div className="px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                    Recurring strength
                  </div>
                  <div className="flex items-baseline justify-between gap-3 mt-1">
                    <div className="text-[14px] font-semibold text-[color:var(--color-text-primary)]">
                      Cross-functional execution
                    </div>
                    <div className="text-[13px] font-semibold text-[color:var(--color-text-primary)] whitespace-nowrap tabular-nums">
                      4/4 roles
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                    Recurring gap
                  </div>
                  <div className="flex items-baseline justify-between gap-3 mt-1">
                    <div className="text-[14px] font-semibold text-[color:var(--color-text-primary)]">
                      Strategy ownership
                    </div>
                    <div className="text-[13px] font-semibold text-[color:var(--color-text-primary)] whitespace-nowrap tabular-nums">
                      3/4 roles
                    </div>
                  </div>
                </div>
              </div>

              <Card intent="warm" padding="lg">
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-warm-accent)] mb-2">
                  Recommended focus
                </div>
                <p className="text-[15px] font-medium leading-[1.5] text-[color:var(--color-text-primary)]">
                  Strengthen evidence of owned strategy decisions and
                  measurable business impact.
                </p>
              </Card>
            </div>
          </section>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
          Hard color transition. No divider, no gradient.
          CHAPTER 2 — Off-white canvas.
          ───────────────────────────────────────────────────────── */}

      <div className="max-w-[72rem] w-full mx-auto px-6">
        {/* Value section — typography + whitespace only. No cards. */}
        <section className="py-16 space-y-6 max-w-[42rem] mx-auto text-center">
          <h2 className="text-[24px] md:text-[28px] font-semibold tracking-[-0.02em]">
            The pattern is the strategy.
          </h2>
          <p className="text-[16px] leading-[1.7] text-[color:var(--color-text-secondary)]">
            CareerMind looks beyond any single job. It identifies the
            strengths and gaps that recur across the roles you&apos;re
            targeting — so you know what to strengthen, how to position
            yourself, and where to focus next.
          </p>
        </section>

        {/* Minimal final CTA — button + one supporting line, no headline. */}
        <section className="py-14 border-t border-[color:var(--color-border-subtle)] text-center space-y-3">
          <Link
            href={primaryCtaHref}
            className="inline-flex items-center rounded-[6px] bg-[color:var(--color-brand-blue)] px-6 py-3 text-[14px] font-medium text-white hover:opacity-90"
          >
            {primaryHeroCtaLabel}
          </Link>
          <p className="text-[13px] text-[color:var(--color-text-muted)]">
            Free during beta.
          </p>
        </section>
      </div>
    </main>
  );
}
