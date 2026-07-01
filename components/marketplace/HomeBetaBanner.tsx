import { Icon } from "../Icons";

/**
 * Subtle, honest beta notice. "Free during beta" is true across the publish flow
 * (see CheckoutPanel / PostTalentPage). Informational only — intentionally not a
 * link, since there is no dedicated pricing page during beta.
 */
export function HomeBetaBanner() {
  return (
    <div className="flex justify-center">
      <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5">
        <Icon name="bolt" className="h-3.5 w-3.5 shrink-0 text-white/55" />
        <p className="truncate text-[12px] font-medium">
          <span className="text-white/80">Free during beta</span>
          <span className="text-white/40"> — post jobs and create talent listings at no cost.</span>
        </p>
      </div>
    </div>
  );
}
