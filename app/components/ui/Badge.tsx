import * as React from "react";

export type BadgeVariant =
  | "neutral"
  | "success"
  | "caution"
  | "danger"
  | "info"
  | "priority";

type BadgeProps = {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  as?: "span" | "div";
};

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral:
    "bg-[color:var(--color-surface-elevated)] text-[color:var(--color-text-secondary)] border-[color:var(--color-border-standard)]",
  success:
    "bg-[color:var(--color-success-bg)] text-[color:var(--color-success-text)] border-[color:var(--color-success-border)]",
  caution:
    "bg-[color:var(--color-caution-bg)] text-[color:var(--color-caution-text)] border-[color:var(--color-caution-border)]",
  danger:
    "bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger-text)] border-[color:var(--color-danger-border)]",
  info:
    "bg-[color:var(--color-info-bg)] text-[color:var(--color-info-text)] border-[color:var(--color-info-border)]",
  priority:
    "bg-[color:var(--color-priority-bg)] text-[color:var(--color-priority-text)] border-[color:var(--color-priority-border)]",
};

/**
 * Small semantic pill. Reserve semantic variants for real signals
 * (verdict, severity, priority). Use `neutral` for everything else.
 */
export default function Badge({
  children,
  variant = "neutral",
  className = "",
  as: Tag = "span",
}: BadgeProps) {
  return (
    <Tag
      className={
        "inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.03em] leading-none " +
        VARIANT_CLASSES[variant] +
        (className ? " " + className : "")
      }
    >
      {children}
    </Tag>
  );
}
