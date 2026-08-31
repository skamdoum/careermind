import * as React from "react";

type EmptyStateProps = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

/**
 * Standardized dashed-border empty state. Reuse everywhere we currently
 * hand-roll one (cross-job insights placeholder, coming-soon panels,
 * "no data yet" states).
 */
export default function EmptyState({
  title,
  description,
  action,
  className = "",
  children,
}: EmptyStateProps) {
  return (
    <div
      className={
        "rounded-[6px] border border-dashed border-[color:var(--color-border-standard)] " +
        "bg-[color:var(--color-surface-elevated)] px-6 py-6 text-center " +
        (className || "")
      }
    >
      {title && (
        <div className="text-[15px] font-semibold text-[color:var(--color-text-primary)]">
          {title}
        </div>
      )}
      {description && (
        <p className="text-[13px] text-[color:var(--color-text-secondary)] mt-1 max-w-lg mx-auto">
          {description}
        </p>
      )}
      {children && <div className="mt-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
