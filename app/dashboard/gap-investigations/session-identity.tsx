import Badge from "@/app/components/ui/Badge";
import type { SavedInvestigation } from "@/lib/gap-investigation/saved";

type Props = { investigation: SavedInvestigation };

export default function SessionIdentity({ investigation }: Props) {
  const { status, created_at, id, saved_answer_count: count } = investigation;
  const date = new Date(created_at);
  const dateLabel = Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }).format(date);
  const progress = count === undefined ? "Answer count unavailable" : `${count} ${count === 1 ? "answer" : "answers"} saved`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[color:var(--color-text-muted)]">
      <Badge variant={status === "concluded" ? "success" : status === "active" ? "info" : "neutral"}>
        {status === "concluded" ? "Concluded" : status === "active" ? "Active" : "Abandoned"}
      </Badge>
      {dateLabel ? <time dateTime={created_at}>Created {dateLabel}</time> : <span>Creation date unavailable</span>}
      <span>{status === "active" && count === 0 ? `Not started — ${progress}` : progress}</span>
      <span title={id}>Session {id.slice(0, 8)}</span>
    </div>
  );
}
