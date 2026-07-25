// Visual primitives for the Import Hiring Post surfaces.
//
// The class constants below are DUPLICATED BY DESIGN from the file-local,
// non-exported constants in components/post-job/PostJobForm.tsx (pill/inputBase/
// textareaBase). That file is guarded by structural tests and stays untouched;
// if the wizard's field styling ever changes, mirror the change here so the
// import flow keeps pixel parity.

export const importPanelClass =
  "rounded-3xl bg-white/[0.06] border border-white/10 p-5 sm:p-6 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]";

export const importTextareaBase =
  "w-full min-h-[110px] rounded-xl bg-white/6 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7 transition-colors";

export const importInputBase =
  "w-full h-11 rounded-xl bg-white/6 border border-white/10 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7 transition-colors";

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
  "ui-press h-11 cursor-pointer rounded-xl bg-white px-5 text-sm font-semibold tracking-wide text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-subtle";

export const importGhostButton =
  "ui-press h-11 cursor-pointer rounded-xl border border-white/12 bg-white/6 px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white";

export const importHelperClass = "text-[11px] text-muted";

export const importAmberTextClass = "text-[12px] text-amber-200/90";

export const importGroupClass = "rounded-2xl border border-white/10 bg-white/[0.04] p-4";

export const importGroupHeadingClass = "text-[11px] font-semibold uppercase tracking-wide text-muted";

export const importEvidenceClass =
  "mt-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] italic leading-relaxed text-white/55 break-words";
