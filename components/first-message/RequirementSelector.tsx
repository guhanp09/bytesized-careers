"use client";

import React from "react";
import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  RequirementContext,
  requirementCopy,
  requirementsForContext,
} from "../../lib/firstMessageRequirements";
import { Icon } from "../Icons";

/**
 * Owner-facing selection of the structured details the *other* side must attach
 * with their opening message. Used in the post-job and post-talent flows.
 *
 * Selecting any requirement clears the explicit "no requirements" choice, and
 * vice versa, so the owner always makes one intentional decision before
 * publishing. Drafts can be saved with neither chosen.
 */
export default function RequirementSelector({
  context,
  selectedKeys,
  onChange,
  noneSelected,
  onNoneChange,
  customInstructionValue = "",
  onCustomInstructionChange,
  customInstructionError,
  hideCustomInstruction = false,
}: {
  context: RequirementContext;
  selectedKeys: string[];
  onChange: (next: string[]) => void;
  noneSelected: boolean;
  onNoneChange: (next: boolean) => void;
  customInstructionValue?: string;
  onCustomInstructionChange?: (next: string) => void;
  customInstructionError?: string;
  hideCustomInstruction?: boolean;
}) {
  const defs = requirementsForContext(context).filter(
    (definition) => !hideCustomInstruction || definition.key !== CUSTOM_INSTRUCTION_REQUIREMENT_KEY
  );
  const selected = new Set(selectedKeys);
  const customInstructionSelected = selected.has(CUSTOM_INSTRUCTION_REQUIREMENT_KEY);

  const toggle = (key: string) => {
    if (selected.has(key)) {
      onChange(selectedKeys.filter((k) => k !== key));
      if (key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY) {
        onCustomInstructionChange?.("");
      }
      return;
    }
    if (noneSelected) onNoneChange(false);
    // Keep registry order for stable, predictable rendering downstream.
    const next = defs.map((d) => d.key).filter((k) => k === key || selected.has(k));
    onChange(next);
  };

  const chooseNone = () => {
    if (noneSelected) {
      onNoneChange(false);
      return;
    }
    onChange([]);
    onCustomInstructionChange?.("");
    onNoneChange(true);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {defs.map((def) => {
          const copy = requirementCopy(def, context);
          if (!copy) return null;
          const isOn = selected.has(def.key);
          return (
            <button
              key={def.key}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(def.key)}
              className={[
                "group relative flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                isOn
                  ? "border-white/35 bg-white/[0.09]"
                  : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.06]",
              ].join(" ")}
            >
              <span
                className={[
                  "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors",
                  isOn ? "border-white/25 bg-white/10 text-white" : "border-white/10 bg-white/[0.05] text-white/60",
                ].join(" ")}
              >
                <Icon name={def.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white/90">{copy.owner}</span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-white/45">{copy.ownerHint}</span>
              </span>
              <span
                className={[
                  "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                  isOn ? "border-white bg-white text-black" : "border-white/15 bg-transparent text-transparent",
                ].join(" ")}
                aria-hidden="true"
              >
                <Icon name="check" className="h-3 w-3" />
              </span>
            </button>
          );
        })}
      </div>

      {customInstructionSelected ? (
        <div
          className={[
            "rounded-2xl border bg-white/[0.04] p-3.5",
            customInstructionError ? "border-amber-200/35" : "border-white/10",
          ].join(" ")}
          data-testid="custom-instruction-editor"
        >
          <label className="text-xs font-semibold text-white/72" htmlFor="job-custom-instruction">
            Screening question
          </label>
          <textarea
            id="job-custom-instruction"
            value={customInstructionValue}
            onChange={(event) => onCustomInstructionChange?.(event.target.value)}
            placeholder="e.g. Share one similar video and explain your role."
            aria-invalid={Boolean(customInstructionError)}
            className={[
              "mt-2 min-h-[84px] w-full rounded-xl border bg-white/[0.05] px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/25 focus:bg-white/[0.07]",
              customInstructionError ? "border-amber-200/35" : "border-white/10",
            ].join(" ")}
          />
          {customInstructionError ? (
            <p className="mt-2 text-xs text-amber-200/90">{customInstructionError}</p>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        aria-pressed={noneSelected}
        onClick={chooseNone}
        className={[
          "flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors",
          noneSelected
            ? "border-white/30 bg-white/[0.08]"
            : "border-dashed border-white/12 bg-transparent hover:border-white/20 hover:bg-white/[0.04]",
        ].join(" ")}
      >
        <span
          className={[
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            noneSelected ? "border-white bg-white text-black" : "border-white/15 bg-transparent text-transparent",
          ].join(" ")}
          aria-hidden="true"
        >
          <Icon name="check" className="h-3 w-3" />
        </span>
        <span className="text-sm font-medium text-white/72">No specific first-message requirements</span>
      </button>
    </div>
  );
}
