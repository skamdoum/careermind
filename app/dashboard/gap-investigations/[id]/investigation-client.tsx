"use client";

import { useState, useRef, useEffect } from "react";
import Card from "@/app/components/ui/Card";
import Badge from "@/app/components/ui/Badge";
import type {
  InvestigationBundle,
  GapInvestigationEvidenceRow,
  ResumeEvidenceStatus,
  TargetRoleFitStatus,
  UnderlyingCapabilityStatus,
  UserEvidenceStatus,
  InvestigationConclusion,
} from "@/lib/db/gap-investigations";

type Props = {
  initialBundle: InvestigationBundle;
};

// Internal label — stored for evaluation and shown as a small debug
// annotation, NOT as the primary user-facing message. The dimension
// trio + residual gap carry the main story.
const CONCLUSION_LABEL: Record<InvestigationConclusion, string> = {
  evidence_gap: "Evidence gap",
  partial_evidence: "Partial evidence",
  capability_gap: "Capability gap",
  scope_mismatch: "Scope mismatch",
};

const UNDERLYING_CAPABILITY_LABEL: Record<UnderlyingCapabilityStatus, string> = {
  demonstrated: "Demonstrated",
  partial: "Partial",
  not_demonstrated: "Not demonstrated",
};

const RESUME_EVIDENCE_LABEL: Record<ResumeEvidenceStatus, string> = {
  demonstrates: "Demonstrates",
  partial: "Partial",
  does_not_demonstrate: "Does not demonstrate",
};

const TARGET_ROLE_FIT_LABEL: Record<TargetRoleFitStatus, string> = {
  meets: "Meets",
  partial: "Partial",
  does_not_meet: "Does not meet",
};

const SOURCE_LABEL = {
  resume: "From resume",
  user: "From your answer",
  inference: "Interpretation",
} as const;

export default function InvestigationClient({ initialBundle }: Props) {
  const [bundle, setBundle] = useState<InvestigationBundle>(initialBundle);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { investigation, turns, evidence } = bundle;
  const concluded = investigation.status === "concluded";

  useEffect(() => {
    // Scroll the newest turn into view whenever the transcript grows.
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, sending]);

  async function submitTurn() {
    const trimmed = content.trim();
    if (!trimmed || sending || concluded) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/gap-investigations/${investigation.id}/turns`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmed }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to send your answer");
      }
      setBundle(json.data as InvestigationBundle);
      setContent("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  async function updateEvidence(
    ev: GapInvestigationEvidenceRow,
    nextStatus: UserEvidenceStatus,
    userEdit?: string
  ) {
    setError(null);
    try {
      const res = await fetch(
        `/api/gap-investigations/${investigation.id}/evidence/${ev.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_status: nextStatus, user_edit: userEdit }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to update evidence");
      }
      setBundle((prev) => ({
        ...prev,
        evidence: prev.evidence.map((e) =>
          e.id === ev.id ? (json.data as GapInvestigationEvidenceRow) : e
        ),
      }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Conversation column */}
      <div className="md:col-span-2 space-y-4">
        {concluded && investigation.conclusion && (
          <Card intent="info" padding="lg">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80">
                Investigation concluded
              </div>

              {(investigation.underlying_capability ||
                investigation.resume_evidence ||
                investigation.target_role_fit) && (
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {investigation.underlying_capability && (
                    <div className="rounded-[6px] border border-[color:var(--color-border-subtle)] bg-[color:var(--color-surface)] px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)]">
                        Underlying capability
                      </dt>
                      <dd className="text-[14px] font-semibold text-[color:var(--color-text-primary)] mt-0.5">
                        {UNDERLYING_CAPABILITY_LABEL[investigation.underlying_capability]}
                      </dd>
                    </div>
                  )}
                  {investigation.resume_evidence && (
                    <div className="rounded-[6px] border border-[color:var(--color-border-subtle)] bg-[color:var(--color-surface)] px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)]">
                        Resume evidence
                      </dt>
                      <dd className="text-[14px] font-semibold text-[color:var(--color-text-primary)] mt-0.5">
                        {RESUME_EVIDENCE_LABEL[investigation.resume_evidence]}
                      </dd>
                    </div>
                  )}
                  {investigation.target_role_fit && (
                    <div className="rounded-[6px] border border-[color:var(--color-border-subtle)] bg-[color:var(--color-surface)] px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)]">
                        Target-role fit
                      </dt>
                      <dd className="text-[14px] font-semibold text-[color:var(--color-text-primary)] mt-0.5">
                        {TARGET_ROLE_FIT_LABEL[investigation.target_role_fit]}
                      </dd>
                    </div>
                  )}
                </dl>
              )}

              {investigation.residual_gap && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)]">
                    Remaining gap
                  </div>
                  <p className="text-[14px] leading-[1.6] text-[color:var(--color-text-primary)] mt-0.5">
                    {investigation.residual_gap}
                  </p>
                </div>
              )}

              {investigation.conclusion_summary && (
                <p className="text-[14px] leading-[1.6] text-[color:var(--color-text-primary)] whitespace-pre-wrap">
                  {investigation.conclusion_summary}
                </p>
              )}

              {investigation.remaining_uncertainty && (
                <p className="text-[13px] text-[color:var(--color-text-secondary)]">
                  <span className="font-semibold">
                    What would still close this fully:
                  </span>{" "}
                  {investigation.remaining_uncertainty}
                </p>
              )}

              <div className="text-[11px] text-[color:var(--color-text-muted)] pt-1">
                Internal classification: {CONCLUSION_LABEL[investigation.conclusion]}
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-3">
          {turns.map((t) => (
            <div
              key={t.id}
              className={
                t.role === "assistant"
                  ? "rounded-[6px] border border-[color:var(--color-border-subtle)] bg-[color:var(--color-surface)] px-4 py-3"
                  : "rounded-[6px] bg-[color:var(--color-surface-elevated)] px-4 py-3 ml-6"
              }
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)] mb-1">
                {t.role === "assistant" ? "CareerMind" : "You"}
              </div>
              <p className="text-[14px] leading-[1.6] text-[color:var(--color-text-primary)] whitespace-pre-wrap">
                {t.content}
              </p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {!concluded && (
          <div className="space-y-2">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={sending}
              rows={4}
              placeholder="Type your answer…"
              className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] leading-[1.6] text-[color:var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent-ink)]"
              onKeyDown={(e) => {
                if (
                  (e.ctrlKey || e.metaKey) &&
                  e.key === "Enter" &&
                  !sending
                ) {
                  e.preventDefault();
                  submitTurn();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px] text-[color:var(--color-text-muted)]">
                Turn {turns.filter((t) => t.role === "user").length + 1}
                {" · "}
                Cmd/Ctrl+Enter to send
              </div>
              <button
                onClick={submitTurn}
                disabled={sending || content.trim().length === 0}
                className="inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-ink)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {sending ? "Thinking…" : "Send"}
              </button>
            </div>
            {error && (
              <div className="text-[13px] text-[color:var(--color-danger-text)]">
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Evidence column */}
      <div className="md:col-span-1 space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)]">
          Candidate evidence · {evidence.length}
        </div>
        {evidence.length === 0 && (
          <div className="text-[13px] text-[color:var(--color-text-muted)]">
            No evidence extracted yet. As you answer, CareerMind will
            capture claims here for you to confirm.
          </div>
        )}
        {evidence.map((ev) => (
          <EvidenceCard
            key={ev.id}
            ev={ev}
            onUpdate={updateEvidence}
            disabled={sending}
          />
        ))}
      </div>
    </div>
  );
}

function EvidenceCard({
  ev,
  onUpdate,
  disabled,
}: {
  ev: GapInvestigationEvidenceRow;
  onUpdate: (
    ev: GapInvestigationEvidenceRow,
    status: UserEvidenceStatus,
    userEdit?: string
  ) => Promise<void>;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(ev.user_edit || ev.claim);

  const statusVariant: "success" | "danger" | "info" | "neutral" =
    ev.user_status === "confirmed"
      ? "success"
      : ev.user_status === "rejected"
      ? "danger"
      : ev.user_status === "edited"
      ? "info"
      : "neutral";

  return (
    <div className="rounded-[6px] border border-[color:var(--color-border-subtle)] bg-[color:var(--color-surface)] px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-muted)]">
          {SOURCE_LABEL[ev.source_type]}
          {ev.evidence_level ? ` · ${ev.evidence_level}` : ""}
        </div>
        <Badge variant={statusVariant}>{ev.user_status}</Badge>
      </div>

      {!editing ? (
        <p className="text-[13px] leading-[1.5] text-[color:var(--color-text-primary)]">
          {ev.user_status === "edited" && ev.user_edit
            ? ev.user_edit
            : ev.claim}
        </p>
      ) : (
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={3}
          className="w-full rounded-[6px] border border-[color:var(--color-border-standard)] bg-[color:var(--color-surface)] px-2 py-1 text-[13px] leading-[1.5]"
        />
      )}

      {ev.resume_excerpt && !editing && (
        <p className="text-[12px] italic text-[color:var(--color-text-muted)] border-l-2 border-[color:var(--color-border-subtle)] pl-2">
          Resume: {ev.resume_excerpt}
        </p>
      )}

      {ev.dimensions && !editing && (
        <details className="text-[12px] text-[color:var(--color-text-muted)]">
          <summary className="cursor-pointer">Ownership / scope / complexity / outcome</summary>
          <ul className="mt-1 space-y-0.5">
            <li>
              <span className="font-semibold">Ownership:</span>{" "}
              {ev.dimensions.ownership || "—"}
            </li>
            <li>
              <span className="font-semibold">Scope:</span>{" "}
              {ev.dimensions.scope || "—"}
            </li>
            <li>
              <span className="font-semibold">Complexity:</span>{" "}
              {ev.dimensions.complexity || "—"}
            </li>
            <li>
              <span className="font-semibold">Outcome:</span>{" "}
              {ev.dimensions.outcome || "—"}
            </li>
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {editing ? (
          <>
            <button
              disabled={disabled || !editText.trim()}
              onClick={async () => {
                await onUpdate(ev, "edited", editText.trim());
                setEditing(false);
              }}
              className="rounded-[6px] bg-[color:var(--color-accent-ink)] px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Save edit
            </button>
            <button
              disabled={disabled}
              onClick={() => {
                setEditing(false);
                setEditText(ev.user_edit || ev.claim);
              }}
              className="rounded-[6px] border border-[color:var(--color-border-standard)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              disabled={disabled || ev.user_status === "confirmed"}
              onClick={() => onUpdate(ev, "confirmed")}
              className="rounded-[6px] border border-[color:var(--color-border-standard)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)] disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              disabled={disabled}
              onClick={() => {
                setEditText(ev.user_edit || ev.claim);
                setEditing(true);
              }}
              className="rounded-[6px] border border-[color:var(--color-border-standard)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            >
              Edit
            </button>
            <button
              disabled={disabled || ev.user_status === "rejected"}
              onClick={() => onUpdate(ev, "rejected")}
              className="rounded-[6px] border border-[color:var(--color-border-standard)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-elevated)] disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
