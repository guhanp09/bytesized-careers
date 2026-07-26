"use client";

/**
 * Payment state, read-only.
 *
 * This reports what a record says. It is not a payment product: there is no
 * checkout, no wallet, no escrow account, no payout and no invoice behind it,
 * and every word here is chosen so a reader cannot conclude otherwise. In
 * particular nothing claims that money is held, protected or guaranteed —
 * "Funded" says the payer reported funding, which is the only thing the column
 * actually knows.
 *
 * It is also deliberately not a status pill. The application lifecycle already
 * owns that shape, and a payment badge sitting beside a stage badge is how a
 * reader ends up believing one drives the other. Nothing here transitions
 * anything.
 */

import { Icon } from "../Icons";
import { InteractionTime } from "./InteractionTime";
import type { BackendPaymentState } from "../../lib/backendClient";

type Tone = "neutral" | "progress" | "settled" | "attention";

const PAYMENT_COPY: Record<BackendPaymentState, { label: string; detail: string; tone: Tone }> = {
  not_applicable: {
    label: "No platform payment",
    detail: "This engagement is settled directly between the two of you.",
    tone: "neutral",
  },
  setup_pending: {
    label: "Payment setup pending",
    detail: "Payment details have not been arranged yet.",
    tone: "neutral",
  },
  funding_pending: {
    label: "Awaiting funding",
    detail: "The payer has not yet confirmed funding.",
    tone: "progress",
  },
  funded: {
    // Not "funds secured". The record says the payer reported funding; it does
    // not say anything is held anywhere, and neither does this.
    label: "Funded",
    detail: "The payer has reported this as funded.",
    tone: "progress",
  },
  work_in_progress: {
    label: "Work in progress",
    detail: "Recorded against the payment, separately from the work status.",
    tone: "progress",
  },
  release_requested: {
    label: "Release requested",
    detail: "A release has been requested and is awaiting confirmation.",
    tone: "progress",
  },
  released: {
    label: "Payment released",
    detail: "The payer has reported this as released.",
    tone: "settled",
  },
  disputed: {
    label: "Payment disputed",
    detail: "A dispute has been raised. This does not change the work status.",
    tone: "attention",
  },
  refunded: {
    label: "Payment refunded",
    detail: "This payment has been reported as refunded.",
    tone: "settled",
  },
  expired: {
    label: "Payment expired",
    detail: "The payment arrangement lapsed without completing.",
    tone: "neutral",
  },
};

const TONE_CLASSES: Record<Tone, { dot: string; label: string }> = {
  neutral: { dot: "bg-white/35", label: "text-default" },
  progress: { dot: "bg-state-interview", label: "text-ink" },
  settled: { dot: "bg-emerald-300", label: "text-ink" },
  attention: { dot: "bg-rose-300", label: "text-ink" },
};

export function PaymentStateCard({
  state,
  updatedAt,
  note,
  className = "",
}: {
  state?: BackendPaymentState | null;
  updatedAt?: string | null;
  note?: string | null;
  className?: string;
}) {
  // Nothing asserted means nothing shown. An empty "Payment: —" row would
  // invent a payment dimension for every engagement that has never had one.
  if (!state) return null;
  const copy = PAYMENT_COPY[state];
  if (!copy) return null;
  const tone = TONE_CLASSES[copy.tone];

  return (
    <section
      data-testid="payment-state"
      data-payment-state={state}
      className={`rounded-2xl border border-line bg-raised p-4 ${className}`}
    >
      <div className="flex items-center gap-2">
        <Icon name="wallet" className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
        <p className="text-[11px] font-semibold text-subtle">Payment</p>
      </div>
      <p className={`mt-2 flex items-center gap-2 text-[13px] font-semibold ${tone.label}`}>
        {/* Never colour alone: the label states the situation in words. */}
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
        {copy.label}
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{copy.detail}</p>
      {note ? (
        <p data-testid="payment-note" className="mt-1.5 text-[11.5px] leading-relaxed text-secondary">
          {note}
        </p>
      ) : null}
      {updatedAt ? (
        <p className="mt-1.5 text-[11px] text-subtle">
          Updated <InteractionTime value={updatedAt} />
        </p>
      ) : null}
      {/*
        Said plainly, because the alternative is a reader assuming this page can
        move their money. It cannot; there is nothing here to press.
      */}
      <p className="mt-2 border-t border-line pt-2 text-[10.5px] leading-relaxed text-subtle">
        Reported status only. Payments are arranged outside CreatorJobs.
      </p>
    </section>
  );
}
