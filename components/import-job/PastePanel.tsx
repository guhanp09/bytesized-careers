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
      <div className="flex items-center gap-2">
        <Icon name="file" className="h-4 w-4 text-white/60" />
        <h2 className="text-xs font-semibold text-white/80">Your hiring post</h2>
        {restoredFromSession ? (
          <span className={`${importHelperClass} ml-auto`}>Restored your last paste.</span>
        ) : pastedNote ? (
          <span className={`${importHelperClass} ml-auto`} data-testid="import-paste-note">
            Pasted — ready to analyze.
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
        autoComplete="off"
        spellCheck={false}
        data-testid="import-textarea"
        className={`${importTextareaBase} mt-3 min-h-[320px] font-mono text-[13px] leading-relaxed sm:min-h-[320px]`}
      />

      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <p className={`${importHelperClass} max-w-md`}>
          Works with LinkedIn posts, WhatsApp messages, Instagram captions, and emails. Plain text works
          best.
        </p>
        <p className={importHelperClass} aria-hidden="true">
          {count.toLocaleString("en-US")} / {MAX_IMPORT_CHARS.toLocaleString("en-US")}
        </p>
      </div>

      {truncatedAtLimit ? (
        <p className={`${importAmberTextClass} mt-2 flex items-center gap-1.5`} data-testid="import-truncation-note">
          <Icon name="alert" className="h-3.5 w-3.5" />
          Your paste was longer than 20,000 characters — we kept the first 20,000.
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-end gap-2 border-t border-white/10 bg-[#0b0b0f]/95 px-4 py-3 backdrop-blur sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-4 sm:backdrop-blur-none">
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
          PREPARE DRAFT
        </button>
      </div>
    </section>
  );
}
