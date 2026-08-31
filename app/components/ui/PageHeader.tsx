import * as React from "react";

type PageHeaderProps = {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
};

/**
 * H1 + optional description + optional right-aligned action.
 * Keeps top-of-page rhythm consistent across every screen.
 */
export default function PageHeader({
  title,
  description,
  action,
  eyebrow,
  className = "",
}: PageHeaderProps) {
  return (
    <header
      className={
        "flex flex-col gap-3 md:flex-row md:items-start md:justify-between " +
        (className || "")
      }
    >
      <div className="min-w-0 space-y-1">
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[28px] font-semibold tracking-[-0.01em] leading-tight text-[color:var(--color-text-primary)]">
          {title}
        </h1>
        {description && (
          <p className="text-[14px] text-[color:var(--color-text-secondary)] max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </header>
  );
}
