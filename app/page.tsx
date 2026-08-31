import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import VerdictHero from "@/app/components/ui/VerdictHero";
import Card from "@/app/components/ui/Card";
import Badge from "@/app/components/ui/Badge";

/**
 * Landing page. Server component so the primary CTA can honor the
 * user's session state and route logged-in users straight into the
 * product without a login round trip.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The intended V1 flow starts at Goals → Target Role → Analyze.
  // Logged-in users go directly; logged-out users hit login with a
  // safe internal-only `next` param so they land in the same place.
  const primaryCtaHref = user
    ? "/dashboard/goals"
    : "/login?next=%2Fdashboard%2Fgoals";
  const primaryCtaLabel = user ? "Go to your dashboard" : "Start CareerMind";

  return (
    <main className="min-h-screen bg-[color:var(--color-page)] text-[color:var(--color-text-primary)]">
      <div className="max-w-[72rem] w-full mx-auto px-6">
        {/* Slim top bar so the landing feels like the same product as the app. */}
        <div className="flex items-center justify-between py-5 border-b border-[color:var(--color-border-subtle)]">
          <Link
            href="/"
            className="text-[15px] font-semibold tracking-[-0.01em]"
          >
            CareerMind
          </Link>
          <div className="flex items-center gap-4 text-[13px]">
            {user ? (
              <Link
                href="/dashboard"
                className="text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
              >
                Go to dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                className="text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
              >
                Sign in
              </Link>
            )}
            <Link
              href={primaryCtaHref}
              className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
            >
              {primaryCtaLabel}
            </Link>
          </div>
        </div>

        {/* Hero */}
        <section className="grid gap-12 py-14 md:grid-cols-2 md:items-center">
          <div className="space-y-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)]">
              Career decisions for experienced PMs
            </div>
            <h1 className="text-[36px] md:text-[44px] font-semibold tracking-[-0.02em] leading-[1.1]">
              The career decision engine for Senior and Principal PMs.
            </h1>
            <p className="text-[16px] leading-[1.6] text-[color:var(--color-text-secondary)] max-w-xl">
              Assess your fit against real roles, see the patterns across your
              target market, choose a positioning strategy, and follow a
              prioritized plan to get there.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href={primaryCtaHref}
                className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-5 py-2.5 text-[14px] font-medium text-white hover:opacity-90"
              >
                {primaryCtaLabel}
              </Link>
              {!user && (
                <Link
                  href="/login"
                  className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-standard)] px-5 py-2.5 text-[14px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
                >
                  Sign in
                </Link>
              )}
            </div>
            <p className="text-[13px] text-[color:var(--color-text-muted)] pt-1">
              Built for Product Managers targeting Senior and Principal roles.
            </p>
          </div>

          {/*
            Stylized product preview composed from the actual shared
            components — Verdict + guidance + one signal + one gap. Because
            it uses the same primitives as the real app, it can never
            structurally drift from what a user sees after signing in.
          */}
          <div aria-hidden="true" className="space-y-4">
            <VerdictHero
              verdict="Borderline"
              summary="You show strong end-to-end product ownership on consumer surfaces, but the resume does not yet demonstrate direct platform strategy or developer-facing ownership at Senior Platform PM scope."
            />

            <Card intent="info" padding="lg">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80 mb-2">
                Job-specific guidance
              </div>
              <p className="text-[15px] leading-[1.6] text-[color:var(--color-text-primary)]">
                Identify a concrete platform-adjacent moment in your resume and
                reframe it as owned platform work, with the measurable outcome
                first.
              </p>
            </Card>

            <Card padding="md">
              <div className="flex items-start justify-between gap-3">
                <div className="text-[15px] font-semibold">
                  Cross-functional product leadership
                </div>
                <Badge variant="success">5/5</Badge>
              </div>
              <p className="text-[13px] leading-[1.6] text-[color:var(--color-text-secondary)] mt-2">
                Multi-team ownership across engineering, design, and go-to-market
                with clear delivery outcomes at Senior scope.
              </p>
            </Card>

            <Card padding="md">
              <div className="flex items-start gap-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[color:var(--color-caution-text)]"
                  aria-label="Medium severity"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">
                    Weak evidence of direct platform strategy ownership
                  </div>
                  <p className="text-[13px] leading-[1.6] text-[color:var(--color-text-secondary)] mt-1">
                    Adjacent work with platform teams is visible, but the
                    resume doesn&apos;t yet show owned platform decisions or
                    developer outcomes.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* Problem */}
        <section className="py-12 space-y-8 border-t border-[color:var(--color-border-subtle)]">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-center">
            Senior PMs don&apos;t need more advice. They need a decision.
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              "Rejection feedback is vague or inconsistent",
              "Resume advice conflicts across sources",
              "No clear read on which roles to actually target",
            ].map((text, i) => (
              <div
                key={i}
                className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-5 text-[14px] text-[color:var(--color-text-secondary)]"
              >
                {text}
              </div>
            ))}
          </div>
        </section>

        {/* Solution */}
        <section className="py-12 space-y-8 border-t border-[color:var(--color-border-subtle)]">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-center">
            From scattered applications to a structured career strategy.
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                step: "1",
                title: "Assess your fit",
                desc: "Structured, JD-grounded evaluation of your resume against each real target role — strengths, gaps, and where you actually stand.",
              },
              {
                step: "2",
                title: "See the patterns",
                desc: "Recurring signals and gaps across your target roles surface what to fix once, not case by case.",
              },
              {
                step: "3",
                title: "Decide and execute",
                desc: "Choose your positioning strategy, then work a prioritized action plan built around your highest-leverage moves.",
              },
            ].map(({ step, title, desc }) => (
              <div
                key={step}
                className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-5 space-y-2"
              >
                <div className="w-7 h-7 rounded-full bg-[color:var(--color-accent-ink)] text-white text-[13px] font-semibold flex items-center justify-center">
                  {step}
                </div>
                <div className="text-[15px] font-semibold">{title}</div>
                <div className="text-[13px] text-[color:var(--color-text-secondary)] leading-[1.6]">
                  {desc}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Differentiation */}
        <section className="py-12 space-y-8 border-t border-[color:var(--color-border-subtle)]">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-center">
            Not another resume tool.
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] p-5 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
                Typical tools
              </div>
              <ul className="text-[14px] text-[color:var(--color-text-secondary)] space-y-2">
                {[
                  "Generic resume advice",
                  "One-off feedback",
                  "No direction, no prioritization",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-[color:var(--color-text-muted)]">—</span>{" "}
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[6px] border border-[color:var(--color-accent-ink)] bg-[color:var(--color-accent-ink)] text-white p-5 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.03em] opacity-80">
                CareerMind
              </div>
              <ul className="text-[14px] space-y-2">
                {[
                  "Structured evaluation grounded in each JD",
                  "Cross-role patterns and positioning strategy",
                  "One prioritized action plan",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="opacity-70">✓</span> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-14 space-y-6 border-t border-[color:var(--color-border-subtle)] text-center">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
            Stop guessing. Start deciding.
          </h2>
          <Link
            href={primaryCtaHref}
            className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-6 py-3 text-[14px] font-medium text-white hover:opacity-90"
          >
            {primaryCtaLabel}
          </Link>
        </section>
      </div>
    </main>
  );
}
