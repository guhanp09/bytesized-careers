"use client";

import React, { useEffect, useState } from "react";
import { Icon } from "../Icons";
import {
  PrivateNote,
  formatNoteTimestamp,
  loadNotes,
  makeNoteId,
  saveNotes,
} from "../../lib/privateNotes";

const INPUT_SURFACE = "rounded-2xl border border-white/[0.08] bg-white/[0.035]";
const LABEL = "text-[11px] font-semibold text-white/40";

/**
 * Private notes for a received interaction: a calm, local-first note surface.
 *
 * Saved notes appear as a small stack of pasted notes above the input — newest in
 * front, older ones hinted behind, browsable with Prev/Next (and ←/→ keys) with a
 * subtle page-turn. The stack is stored per conversation in localStorage; the
 * newest note is also pushed to `onSaveLatest` so the existing single-note backend
 * field (and the pipeline note indicator) stay in sync. Seeded from prior notes so
 * the experience has history before the user writes anything.
 */
export default function PrivateNotesPanel({
  conversationId,
  counterpartyName,
  seedNotes = [],
  onSaveLatest,
}: {
  conversationId: string;
  counterpartyName: string;
  seedNotes?: PrivateNote[];
  onSaveLatest?: (body: string | null) => Promise<void> | void;
}) {
  const [notes, setNotes] = useState<PrivateNote[]>(seedNotes);
  const [draft, setDraft] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");
  // Direction of travel for the page-turn: +1 older (slide from right), -1 newer.
  const [flipFrom, setFlipFrom] = useState("-10px");

  // Load this conversation's stored stack on mount / when the thread changes.
  // (Runs client-side only, so localStorage access stays out of SSR.)
  useEffect(() => {
    const stored = loadNotes(conversationId);
    setNotes(stored ?? seedNotes);
    setActiveIndex(0);
    setDraft("");
    setSaveState("idle");
    // seedNotes is derived from the same conversation; keying on the id is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = window.setTimeout(() => setSaveState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  const clampIndex = (index: number, length: number) => Math.max(0, Math.min(index, Math.max(0, length - 1)));

  const goTo = (index: number, direction: 1 | -1) => {
    setFlipFrom(direction > 0 ? "10px" : "-10px");
    setActiveIndex(index);
  };

  const handleSave = async () => {
    const body = draft.trim();
    if (!body) return;
    const note: PrivateNote = {
      id: makeNoteId(),
      body,
      createdAt: formatNoteTimestamp(),
      conversationId,
    };
    const next = [note, ...notes];
    setNotes(next);
    saveNotes(conversationId, next);
    setDraft("");
    setFlipFrom("-10px");
    setActiveIndex(0);
    // Local save is the source of truth for the stack; sync the latest note to the
    // backend/pipeline field but never let a sync failure lose the local note.
    setSaveState("saved");
    try {
      await onSaveLatest?.(body);
    } catch {
      /* kept locally */
    }
  };

  const handleDelete = (id: string) => {
    const next = notes.filter((note) => note.id !== id);
    setNotes(next);
    saveNotes(conversationId, next);
    setActiveIndex((index) => clampIndex(index, next.length));
    void onSaveLatest?.(next[0]?.body ?? null);
  };

  const hasNotes = notes.length > 0;
  const activeNote = hasNotes ? notes[clampIndex(activeIndex, notes.length)] : null;
  const canPrev = activeIndex > 0; // newer
  const canNext = activeIndex < notes.length - 1; // older
  const firstName = counterpartyName.split(/\s+/)[0] || counterpartyName;

  return (
    <div className="space-y-3">
      {activeNote ? (
        <section data-testid="saved-notes-card" className="rounded-2xl border border-amber-200/[0.14] bg-amber-100/[0.035] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className={LABEL}>Saved notes</p>
              <span
                data-testid="saved-notes-count"
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-200/15 px-1 text-[10px] font-semibold text-amber-100/90"
              >
                {notes.length}
              </span>
            </div>
          </div>

          <div
            className="relative mt-3 focus:outline-none"
            role="group"
            aria-label="Saved notes"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" && canPrev) {
                event.preventDefault();
                goTo(activeIndex - 1, -1);
              } else if (event.key === "ArrowRight" && canNext) {
                event.preventDefault();
                goTo(activeIndex + 1, 1);
              }
            }}
          >
            {/* Hint the depth of the stack with 1–2 offset cards behind the front note. */}
            {notes.length > 1 ? (
              <div aria-hidden className="absolute inset-0 translate-y-1.5 rotate-[-1.3deg] rounded-xl border border-amber-200/10 bg-amber-100/[0.02]" />
            ) : null}
            {notes.length > 2 ? (
              <div aria-hidden className="absolute inset-0 translate-y-[11px] rotate-[1.4deg] rounded-xl border border-amber-200/[0.07] bg-amber-100/[0.015]" />
            ) : null}

            <article
              key={activeNote.id}
              data-testid="saved-note"
              className="note-flip relative rounded-xl border border-amber-200/[0.16] bg-amber-100/[0.05] p-3.5 shadow-[0_12px_30px_-24px_rgba(0,0,0,0.9)]"
              style={{ "--note-flip-from": flipFrom } as React.CSSProperties}
            >
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/[0.88]">
                {activeNote.body}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[10.5px] text-white/40">
                  <Icon name="eye" className="h-3 w-3" />
                  {activeNote.createdAt} · Only you
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(activeNote.id)}
                  aria-label="Delete this note"
                  className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/60"
                >
                  <Icon name="trash" className="h-3 w-3" />
                </button>
              </div>
            </article>
          </div>

          {notes.length > 1 ? (
            <div className="mt-2.5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => goTo(activeIndex - 1, -1)}
                disabled={!canPrev}
                aria-label="Newer note"
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Icon name="chevron-left" className="h-3.5 w-3.5" />
              </button>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {notes.map((note, index) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => goTo(index, index > activeIndex ? 1 : -1)}
                      aria-label={`Note ${index + 1}`}
                      aria-current={index === activeIndex}
                      className={[
                        "h-1.5 rounded-full transition-all",
                        index === activeIndex ? "w-4 bg-amber-200/70" : "w-1.5 bg-white/20 hover:bg-white/35",
                      ].join(" ")}
                    />
                  ))}
                </div>
                <span className="text-[10.5px] tabular-nums text-white/40">
                  {activeIndex + 1} of {notes.length}
                </span>
              </div>

              <button
                type="button"
                onClick={() => goTo(activeIndex + 1, 1)}
                disabled={!canNext}
                aria-label="Older note"
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Icon name="chevron-right" className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section data-testid="private-note-card" className={`${INPUT_SURFACE} p-4`}>
        <div className="flex items-center justify-between gap-2">
          <p className={LABEL}>{hasNotes ? "Add a note" : "Private notes"}</p>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-white/35">
            <Icon name="eye" className="h-3 w-3" />
            Only you can see this
          </span>
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={5000}
          data-testid="private-note-input"
          aria-label="Private note"
          placeholder={`Jot down where ${firstName} stands — rates, fit, next steps…`}
          className="mt-2.5 w-full resize-none rounded-lg border border-white/[0.1] bg-black/20 px-3 py-2.5 text-[13px] leading-relaxed text-white/85 placeholder:text-white/35 transition-colors focus:border-white/25 focus:outline-none"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void handleSave();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {saveState === "saved" ? (
            <p className="inline-flex items-center gap-1 text-[11px] text-emerald-200/80">
              <Icon name="check" className="h-3 w-3" />
              Saved
            </p>
          ) : !hasNotes ? (
            <p className="text-[11px] text-white/35">Add a private note for follow-ups, rates, or things to confirm.</p>
          ) : (
            <span />
          )}
          <button
            type="button"
            data-testid="private-note-save"
            onClick={() => void handleSave()}
            disabled={!draft.trim()}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Save note
          </button>
        </div>
      </section>
    </div>
  );
}
