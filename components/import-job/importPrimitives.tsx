// Visual primitives for the Import Hiring Post surfaces.
//
// The class constants below are DUPLICATED BY DESIGN from the file-local,
// non-exported constants in components/post-job/PostJobForm.tsx (pill/inputBase/
// textareaBase). That file is guarded by structural tests and stays untouched;
// if the wizard's field styling ever changes, mirror the change here so the
// import flow keeps pixel parity.

export const importPanelClass =
  "rounded-[28px] border border-line bg-panel p-4 elev-2 sm:p-6";

export const importTextareaBase =
  "w-full min-h-[110px] rounded-2xl border border-line-mid bg-raised px-4 py-3 text-sm text-ink placeholder:text-subtle outline-none transition-colors focus:border-line-strong focus:bg-elevated focus-visible:ring-2 focus-visible:ring-focus/35";

export const importInputBase =
  "h-12 w-full rounded-xl border border-line-mid bg-raised px-3.5 text-sm text-ink placeholder:text-subtle outline-none transition-colors focus:border-line-strong focus:bg-elevated focus-visible:ring-2 focus-visible:ring-focus/35";

export const importPill = (active: boolean) =>
  [
    "h-10 cursor-pointer px-3 rounded-xl text-sm font-semibold",
    "border border-white/12 ring-1 ring-white/5",
    "shadow-[0_12px_28px_-20px_rgba(0,0,0,0.95)]",
    "transition-all duration-150",
    active
      ? "bg-white text-black"
      : "bg-white/7 text-white/80 hover:bg-white/10 hover:text-white",
  ].join(" ");

/** Outlined "Suggested" treatment for an uncommitted category chip (plan D13). */
export const importSuggestedPill =
  "h-10 cursor-pointer px-3 rounded-xl text-sm font-semibold border border-dashed border-white/30 bg-transparent text-white/80 hover:bg-white/8 transition-all duration-150";

export const importPrimaryButton =
  "ui-press surface-primary elev-2 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-white px-5 text-sm font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:bg-none disabled:text-disabled disabled:shadow-none";

export const importGhostButton =
  "ui-press inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-line-mid bg-raised px-4 text-sm font-semibold text-secondary transition-colors hover:border-line-strong hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 disabled:cursor-not-allowed disabled:opacity-40";

export const importHelperClass = "text-[11px] text-muted";

export const importAmberTextClass = "text-[12px] text-amber-200/90";

export const importGroupClass = "rounded-2xl border border-white/10 bg-white/[0.04] p-4";

export const importGroupHeadingClass = "text-[11px] font-semibold uppercase tracking-wide text-muted";

export const importEvidenceClass =
  "mt-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] italic leading-relaxed text-white/55 break-words";
