import * as React from "react";

export type CardIntent =
  | "default"
  | "success"
  | "caution"
  | "danger"
  | "info"
  | "warm";
export type CardPadding = "sm" | "md" | "lg";

type CardProps = {
  children: React.ReactNode;
  intent?: CardIntent;
  padding?: CardPadding;
  className?: string;
  as?: "div" | "section" | "article";
};

const INTENT_CLASSES: Record<CardIntent, string> = {
  default:
    "bg-[color:var(--color-surface)] border-[color:var(--color-border-standard)]",
  success:
    "bg-[color:var(--color-success-bg)] border-[color:var(--color-success-border)] text-[color:var(--color-success-text)]",
  caution:
    "bg-[color:var(--color-caution-bg)] border-[color:var(--color-caution-border)] text-[color:var(--color-caution-text)]",
  danger:
    "bg-[color:var(--color-danger-bg)] border-[color:var(--color-danger-border)] text-[color:var(--color-danger-text)]",
  info:
    "bg-[color:var(--color-info-bg)] border-[color:var(--color-info-border)] text-[color:var(--color-info-text)]",
  // Warm terracotta surface — reserved for prioritized-focus intelligence
  // (Recommended Focus card). Body text stays primary; the eyebrow
  // above the surface can use the warm-accent color for its label to
  // signal "this is the earned warm moment on this page."
  warm:
    "bg-[color:var(--color-warm-bg)] border-[color:var(--color-warm-border)] text-[color:var(--color-text-primary)]",
};

const PADDING_CLASSES: Record<CardPadding, string> = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

/**
 * Single card primitive covering both tier-3 (default) and tier-4 (semantic).
 * No shadow — CareerMind is a document, not a widget.
 */
export default function Card({
  children,
  intent = "default",
  padding = "md",
  className = "",
  as: Tag = "div",
}: CardProps) {
  return (
    <Tag
      className={
        "rounded-[6px] border " +
        INTENT_CLASSES[intent] +
        " " +
        PADDING_CLASSES[padding] +
        (className ? " " + className : "")
      }
    >
      {children}
    </Tag>
  );
}
