"use client";

import React from "react";
import { Icon } from "../Icons";
import { MAX_IMPORT_CHARS } from "../../lib/importJob/normalize";
import {
  importAmberTextClass,
  importGhostButton,
  importHelperClass,
  importPanelClass,
  importPrimaryButton,
  importTextareaBase,
} from "./importPrimitives";

const PLACEHOLDER = [
  "Paste your hiring post here.",
  "",
  "Example: 🎬 We're hiring! Looking for a long-form video editor for our finance YouTube channel. ₹25–35k/month, remote. 2+ years with Premiere Pro. DM to apply.",
].join("\n");

export default function PastePanel({
  text,
  truncatedAtLimit,
  restoredFromSession,
  onTextChange,
  onPrepare,
  onClearRequest,
}: {
  text: string;
  truncatedAtLimit: boolean;
  restoredFromSession: boolean;
  onTextChange: (text: string) => void;
  onPrepare: () => void;
  onClearRequest: () => void;
}) {
  const [pastedNote, setPastedNote] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const noteTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
    return () => {
      if (noteTimerRef.current !== null) window.clearTimeout(noteTimerRef.current);
    };
  }, []);

  const handlePaste = () => {
    if (text.trim()) return;
    setPastedNote(true);
    if (noteTimerRef.current !== null) window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => setPastedNote(false), 2200);
  };

  const count = Array.from(text).length;
  const prepareDisabled = !text.trim();

  return (
    <section className={importPanelClass}>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-raised text-secondary elev-1">
          <Icon name="file" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight text-ink">Paste a job post</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Add the existing copy as-is. Bea will turn it into a CreatorJobs draft.
          </p>
        </div>
        {restoredFromSession ? (
          <span className={`${importHelperClass} shrink-0 rounded-full bg-wash-strong px-2.5 py-1`}>Restored</span>
        ) : pastedNote ? (
          <span className={`${importHelperClass} shrink-0 rounded-full bg-wash-strong px-2.5 py-1`} data-testid="import-paste-note">
            Ready
          </span>
        ) : null}
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onPaste={handlePaste}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !prepareDisabled) {
            event.preventDefault();
            onPrepare();
          }
        }}
        placeholder={PLACEHOLDER}
        aria-label="Pasted hiring post"
        aria-describedby="import-text-help import-text-count"
        autoComplete="off"
        spellCheck={false}
        data-testid="import-textarea"
        className={`${importTextareaBase} mt-5 min-h-[240px] resize-y text-[14px] leading-6 sm:min-h-[300px]`}
      />

      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <p id="import-text-help" className={`${importHelperClass} max-w-md leading-5`}>
          Works with LinkedIn posts, WhatsApp messages, Instagram captions, and emails. Plain text works
          best.
        </p>
        <p id="import-text-count" className={`${importHelperClass} tabular-nums`} aria-live="polite">
          {count.toLocaleString("en-US")} / {MAX_IMPORT_CHARS.toLocaleString("en-US")}
        </p>
      </div>

      {truncatedAtLimit ? (
        <p className={`${importAmberTextClass} mt-2 flex items-center gap-1.5`} data-testid="import-truncation-note">
          <Icon name="alert" className="h-3.5 w-3.5" />
          Your paste was longer than 20,000 characters — we kept the first 20,000.
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-5 flex items-center justify-end gap-2 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-5 sm:backdrop-blur-none">
        {text.trim() ? (
          <button type="button" className={importGhostButton} onClick={onClearRequest} data-testid="import-clear">
            Clear
          </button>
        ) : null}
        <button
          type="button"
          className={importPrimaryButton}
          onClick={onPrepare}
          disabled={prepareDisabled}
          data-testid="import-prepare"
        >
          Prepare draft
        </button>
      </div>
    </section>
  );
}
