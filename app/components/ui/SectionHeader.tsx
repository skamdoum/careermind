import * as React from "react";

type SectionHeaderProps = {
  title: string;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

/**
 * H2 + optional eyebrow, description, and right-aligned meta or action.
 * Used to open sections that stand alone (tier-1 bare) OR precede a
 * card list.
 */
export default function SectionHeader({
  title,
  eyebrow,
  description,
  meta,
  action,
  className = "",
}: SectionHeaderProps) {
  return (
    <header
      className={
        "flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between " +
        (className || "")
      }
    >
      <div className="min-w-0 space-y-1">
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
            {eyebrow}
          </div>
        )}
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-[color:var(--color-text-primary)]">
          {title}
        </h2>
        {description && (
          <p className="text-[13px] text-[color:var(--color-text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {(meta || action) && (
        <div className="flex items-center gap-3 flex-shrink-0">
          {meta && (
            <span className="text-[12px] text-[color:var(--color-text-muted)]">
              {meta}
            </span>
          )}
          {action}
        </div>
      )}
    </header>
  );
}
