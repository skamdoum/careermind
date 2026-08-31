"use client";

import * as React from "react";
import { useCallback, useRef, useState } from "react";

type DropZoneProps = {
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void | Promise<void>;
  label?: string;
  hint?: string;
  className?: string;
};

/**
 * Styled replacement for a native <input type="file">. Wraps a hidden
 * input so it still passes browser-level accessibility and mobile
 * upload paths. Drag-and-drop is a bonus; the primary interaction is
 * click-to-choose.
 *
 * Auto-fires onFile as soon as a file is picked — no separate upload
 * click. The consumer is expected to handle the upload lifecycle
 * (state, errors) since that's where the resume-identity contract
 * lives per V2.1 fix.
 *
 * Deliberately does NOT use a <label htmlFor> around the visible
 * content: pairing a label with an outer role="button" wrapper causes
 * the file dialog to open twice per click (label default action +
 * wrapper onClick both call the hidden input). We keep the wrapper
 * as the sole click target and let the wrapper's onClick be the
 * single entry point.
 */
export default function DropZone({
  accept,
  disabled = false,
  onFile,
  label = "Drop a file or click to upload",
  hint = "PDF, DOC, DOCX, or TXT",
  className = "",
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      void onFile(file);
    },
    [onFile]
  );

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  return (
    <div
      className={
        "rounded-[6px] border border-dashed px-6 py-8 text-center transition " +
        (dragOver && !disabled
          ? "border-[color:var(--color-accent-ink)] bg-[color:var(--color-accent-ink-tint)] "
          : "border-[color:var(--color-border-standard)] bg-[color:var(--color-surface-elevated)] ") +
        (disabled
          ? "opacity-60 cursor-not-allowed "
          : "cursor-pointer hover:border-[color:var(--color-accent-ink)] ") +
        (className || "")
      }
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={label}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="text-[14px] font-semibold text-[color:var(--color-text-primary)] pointer-events-none">
        {label}
      </div>
      <div className="text-[12px] text-[color:var(--color-text-muted)] mt-1 pointer-events-none">
        {hint}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = e.target.files;
          // Reset the input so re-picking the same filename still fires onChange.
          e.target.value = "";
          handleFiles(files);
        }}
      />
    </div>
  );
}
