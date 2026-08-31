import * as React from "react";

type MetaItem = {
  label: string;
  value: React.ReactNode;
};

type MetaStripProps = {
  items: MetaItem[];
  className?: string;
};

/**
 * Tier-2 muted metadata strip. Use for analysis IDs, timestamps, resume
 * name, target-job pointer — things that used to sit in full bordered
 * cards but are just context, not intelligence.
 */
export default function MetaStrip({ items, className = "" }: MetaStripProps) {
  if (!items || items.length === 0) return null;

  return (
    <div
      className={
        "rounded-[6px] bg-[color:var(--color-surface-elevated)] px-4 py-3 " +
        "flex flex-wrap gap-x-6 gap-y-2 text-[13px] " +
        (className || "")
      }
    >
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[color:var(--color-text-muted)]">
            {item.label}
          </span>
          <span className="text-[color:var(--color-text-primary)] truncate">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
