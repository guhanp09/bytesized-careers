"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icons";
import { completeLaunchFreeCheckout, type BackendEntitlement } from "../../lib/backendClient";

const PRICE_COPY: Record<BackendEntitlement["kind"], { title: string; standard: string }> = {
  job_post: { title: "Standard job post", standard: "₹4,999" },
  talent_listing: { title: "Standard talent listing", standard: "₹499" },
  featured_job: { title: "Featured job", standard: "₹7,499" },
  featured_talent_listing: { title: "Featured talent listing", standard: "₹999" },
};

export function CheckoutPanel({
  accessToken,
  kind,
  targetType,
  targetId,
  nextUrl,
}: {
  accessToken: string;
  kind: BackendEntitlement["kind"];
  targetType?: string | null;
  targetId?: string | null;
  nextUrl?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const copy = PRICE_COPY[kind];
  const returnHref = nextUrl || "/drafts";

  return (
    <section className="rounded-[32px] border border-white/[0.08] bg-white/[0.04] p-6 text-white shadow-[0_18px_60px_-42px_rgba(0,0,0,0.95)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/38">Launch-free checkout</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{copy.title}</h1>
          <p className="mt-2 text-sm leading-6 text-white/56">
            Free during beta. No payment is required right now. This confirmation creates the entitlement and keeps publishing tied to a real platform action.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 px-4 py-3 text-right">
          <p className="text-xs text-white/42">Due today</p>
          <p className="text-2xl font-semibold text-white">₹0</p>
        </div>
      </div>

      <div className="mt-7 divide-y divide-white/10 rounded-2xl border border-white/10">
        <Row label="Standard price" value={copy.standard} />
        <Row label="Launch beta adjustment" value={`-${copy.standard}`} />
        <Row label="Total due now" value="₹0" strong />
      </div>

      <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-sm leading-6 text-white/55">
        Your listing can still be edited, paused, or closed later from your workspace. No payment method is required during beta.
      </div>

      {status === "error" ? (
        <p className="mt-4 text-sm text-red-200/80">Couldn’t complete checkout. Try again.</p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={status === "working"}
          className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={async () => {
            setStatus("working");
            try {
              await completeLaunchFreeCheckout(accessToken, {
                kind,
                target_type: targetType || null,
                target_id: targetId || null,
                checkout_intent_id: `launch_${kind}_${Date.now()}`,
              });
              setStatus("done");
              router.push(returnHref);
              router.refresh();
            } catch {
              setStatus("error");
            }
          }}
        >
          {status === "done" ? <Icon name="check" className="h-4 w-4" /> : null}
          {status === "working" ? "Confirming..." : status === "done" ? "Confirmed" : "Confirm free checkout"}
        </button>
        <button
          type="button"
          onClick={() => router.push(returnHref)}
          className="inline-flex h-11 cursor-pointer items-center rounded-full border border-white/[0.1] bg-white/[0.045] px-5 text-sm font-semibold text-white/76 transition hover:bg-white/[0.07] hover:text-white"
        >
          Back
        </button>
      </div>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <span className="text-white/52">{label}</span>
      <span className={strong ? "font-semibold text-white" : "text-white/74"}>{value}</span>
    </div>
  );
}
