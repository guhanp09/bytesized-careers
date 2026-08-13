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

// One line, not two paragraphs. The box is the affordance; a placeholder that
// explains the box competes with the copy the recruiter is about to drop into
// it, and the example was longer than most real hiring posts.
const PLACEHOLDER =
  "Paste the job post — a LinkedIn post, a WhatsApp message, an email, anything you already wrote.";

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
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          {/* The icon tile is gone. It labelled a box that is already
              unmistakably a box for text, and it pushed the heading off the
              card's left edge so nothing on the surface shared an axis. */}
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            Paste the job post
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-muted">
            Exactly as you wrote it. Formatting, emoji and all.
          </p>
        </div>
        {restoredFromSession ? (
          <span className={`${importHelperClass} shrink-0 rounded-full bg-wash-strong px-2.5 py-1`}>Restored</span>
        ) : pastedNote ? (
          <span
            className={`${importHelperClass} ui-rise shrink-0 rounded-full bg-wash-strong px-2.5 py-1`}
            data-testid="import-paste-note"
          >
            Got it
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
        className={`${importTextareaBase} mt-5 min-h-[220px] resize-y text-[14px] leading-6 sm:min-h-[260px]`}
      />

      <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <p id="import-text-help" className={`${importHelperClass} max-w-sm leading-5`}>
          {/* Only shown while it is still useful. Once there is text on the
              screen, listing where text can come from is telling the recruiter
              something they have already done. */}
          {count ? "⌘⏎ prepares the draft." : "Plain text reads best."}
        </p>
        <p
          id="import-text-count"
          className={`${importHelperClass} tabular-nums ${count ? "" : "opacity-0"}`}
          aria-live="polite"
        >
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
          className={`${importPrimaryButton} flex-1 sm:flex-none`}
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
