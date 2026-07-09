"use client";

import React from "react";
import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  CustomInstructionAnswer,
  CurrencyAnswer,
  FirstMessageAnswers,
  PortfolioRef,
  ReferenceLink,
  RequirementAnswerValue,
  RequirementContext,
  TurnaroundAnswer,
  emptyAnswerFor,
  getRequirementDef,
  isCurrencyAnswer,
  isCustomInstructionAnswer,
  isPortfolioAnswer,
  isStringArray,
  referenceLinkUrl,
  isTurnaroundAnswer,
  requirementCopy,
  sanitizeRequirementKeys,
} from "../../lib/firstMessageRequirements";
import { Icon } from "../Icons";
import ToolPicker from "../you/ToolPicker";

export type PortfolioOption = {
  id: string;
  title: string;
  url?: string;
  thumbnailUrl?: string | null;
  subtitle?: string | null;
};

export type PortfolioState = {
  items: PortfolioOption[];
  loading?: boolean;
  error?: string | null;
  /**
   * When provided, the picker offers an in-flow "Add project to portfolio" action.
   * The host owns the Add Project modal + persistence so a new project is saved to
   * the requester's real profile portfolio and auto-selected, without leaving the
   * apply flow. Omitted (e.g. signed-out) → only the link fallback is offered.
   */
  onAddProject?: () => void;
};

const inputBase =
  "w-full h-11 rounded-xl bg-white/6 border border-white/10 px-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25 focus:bg-white/7 transition-colors";
const textareaBase =
  "w-full min-h-[96px] rounded-xl bg-white/6 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25 focus:bg-white/7 transition-colors";
const customTextareaBase =
  "w-full min-h-[150px] rounded-xl bg-white/6 border border-white/10 px-3 py-3 text-sm leading-relaxed text-white placeholder:text-white/35 outline-none focus:border-white/25 focus:bg-white/7 transition-colors";
const selectBase =
  "h-11 cursor-pointer rounded-xl bg-white/6 border border-white/10 px-3 text-sm text-white outline-none focus:border-white/25 focus:bg-white/7 transition-colors";
const invalidClass = "border-amber-200/40 ring-1 ring-amber-200/25 focus:border-amber-200/50";
const chip = (active: boolean) =>
  [
    "h-8 cursor-pointer px-3 rounded-lg text-xs font-semibold border transition-colors",
    active ? "bg-white text-black border-white" : "bg-white/6 text-white/75 border-white/12 hover:bg-white/10 hover:text-white",
  ].join(" ");

const TURN_UNITS: TurnaroundAnswer["unit"][] = ["hours", "days", "weeks"];
const CUSTOM_INSTRUCTION_MAX_LENGTH = 3000;

function FieldShell({
  icon,
  label,
  error,
  hint,
  dataKey,
  children,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  error?: string;
  hint?: string;
  dataKey?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5" data-requirement-key={dataKey}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/82">
          <Icon name={icon} className="h-3.5 w-3.5 text-white/45" />
          <span>{label}</span>
        </div>
        {error ? (
          <div className="inline-flex items-center gap-1 text-[11px] text-amber-200/90">
            <Icon name="alert" className="h-3 w-3" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
      {children}
      {!error && hint ? <div className="text-[11px] text-white/40">{hint}</div> : null}
    </div>
  );
}

function PortfolioPicker({
  selected,
  onChange,
  portfolio,
  placeholder,
}: {
  selected: PortfolioRef[];
  onChange: (next: PortfolioRef[]) => void;
  portfolio?: PortfolioState;
  placeholder?: string;
}) {
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkValue, setLinkValue] = React.useState("");
  const items = portfolio?.items ?? [];
  const loading = portfolio?.loading;
  const onAddProject = portfolio?.onAddProject;
  const selectedIds = new Set(selected.map((s) => s.id));

  const toggleItem = (opt: PortfolioOption) => {
    if (selectedIds.has(opt.id)) {
      onChange(selected.filter((s) => s.id !== opt.id));
      return;
    }
    onChange([...selected, { id: opt.id, title: opt.title, url: opt.url }]);
  };

  const addLink = () => {
    const url = linkValue.trim();
    if (!url) return;
    const id = `link:${url}`;
    if (selectedIds.has(id)) {
      setLinkValue("");
      return;
    }
    onChange([...selected, { id, title: url, url }]);
    setLinkValue("");
    setLinkOpen(false);
  };

  const linkRefs = selected.filter((s) => s.id.startsWith("link:"));

  return (
    <div className="space-y-2.5">
      {loading ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-white/45">
          Loading your portfolio…
        </div>
      ) : items.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((opt) => {
            const isOn = selectedIds.has(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={isOn}
                onClick={() => toggleItem(opt)}
                className={[
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-2 text-left transition-colors",
                  isOn ? "border-white/35 bg-white/[0.09]" : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.06]",
                ].join(" ")}
              >
                <span className="relative h-11 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.05]">
                  {opt.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={opt.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-white/35">
                      <Icon name="image" className="h-4 w-4" />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-white/88">{opt.title}</span>
                  {opt.subtitle ? <span className="mt-0.5 block truncate text-[11px] text-white/42">{opt.subtitle}</span> : null}
                </span>
                <span
                  className={[
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                    isOn ? "border-white bg-white text-black" : "border-white/15 text-transparent",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  <Icon name="check" className="h-3 w-3" />
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/12 bg-white/[0.02] px-3 py-4 text-xs leading-relaxed text-white/50">
          {onAddProject
            ? "No portfolio projects on your profile yet. Add one below — it’s saved to your profile and attached to this application."
            : "No portfolio items on your profile yet. Add work to your profile, or attach a link below so they can still see your work."}
        </div>
      )}

      {portfolio?.error ? <p className="text-[11px] text-amber-200/80">{portfolio.error}</p> : null}

      {linkRefs.length ? (
        <div className="flex flex-wrap gap-2">
          {linkRefs.map((ref) => (
            <span
              key={ref.id}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/8 px-2 py-1 text-[11px] text-white/80"
            >
              <Icon name="external-link" className="h-3 w-3 text-white/45" />
              <span className="max-w-[180px] truncate">{ref.url}</span>
              <button
                type="button"
                onClick={() => onChange(selected.filter((s) => s.id !== ref.id))}
                className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded text-white/55 hover:text-white"
                aria-label="Remove link"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onAddProject ? (
          <button
            type="button"
            onClick={onAddProject}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-white/80 transition-colors hover:text-white"
          >
            <Icon name="plus" className="h-3 w-3" />
            {items.length ? "Add another project" : "Add project to portfolio"}
          </button>
        ) : null}
        {linkOpen ? null : (
          <button
            type="button"
            onClick={() => setLinkOpen(true)}
            className={[
              "inline-flex cursor-pointer items-center gap-1.5 font-semibold transition-colors",
              onAddProject
                ? "text-[11px] text-white/45 hover:text-white/75"
                : "text-[11px] text-white/55 hover:text-white/80",
            ].join(" ")}
          >
            {onAddProject ? null : <Icon name="plus" className="h-3 w-3" />}
            {onAddProject || items.length ? "Attach a link instead" : "Attach a link"}
          </button>
        )}
      </div>

      {linkOpen ? (
        <div className="flex gap-2">
          <input
            autoFocus
            type="url"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
            placeholder="https://…"
            className={inputBase}
          />
          <button
            type="button"
            onClick={addLink}
            className="h-11 shrink-0 cursor-pointer rounded-xl bg-white px-3 text-sm font-semibold text-black hover:bg-white/90"
          >
            Add
          </button>
        </div>
      ) : null}
      {placeholder && items.length ? <p className="text-[11px] text-white/40">{placeholder}</p> : null}
    </div>
  );
}

function CustomInstructionField({
  value,
  prompt,
  error,
  onChange,
}: {
  value: RequirementAnswerValue;
  prompt?: string;
  error?: string;
  onChange: (next: CustomInstructionAnswer) => void;
}) {
  const answer: CustomInstructionAnswer = isCustomInstructionAnswer(value)
    ? value
    : { response: typeof value === "string" ? value : "", links: [] };
  const resolvedPrompt = prompt?.trim() || answer.prompt?.trim() || "Screening question";
  const links = answer.links || [];
  const update = (patch: Partial<CustomInstructionAnswer>) => {
    onChange({
      prompt: resolvedPrompt,
      response: patch.response ?? answer.response ?? "",
      links: patch.links ?? links,
    });
  };

  return (
    <div className="space-y-2" data-requirement-key={CUSTOM_INSTRUCTION_REQUIREMENT_KEY}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-white/82">
          <Icon name="message-square-plus" className="h-3.5 w-3.5 shrink-0 text-white/45" />
          <span className="truncate">Listing prompt</span>
        </div>
        {error ? (
          <div className="inline-flex shrink-0 items-center gap-1 text-[11px] text-amber-200/90">
            <Icon name="alert" className="h-3 w-3" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      <div
        className={[
          "rounded-2xl border bg-white/[0.035] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
          error ? "border-amber-200/35" : "border-white/[0.09]",
        ].join(" ")}
      >
        <p className="text-sm font-semibold leading-relaxed text-white/88">{resolvedPrompt}</p>
        <textarea
          value={answer.response}
          onChange={(event) => update({ response: event.target.value.slice(0, CUSTOM_INSTRUCTION_MAX_LENGTH) })}
          maxLength={CUSTOM_INSTRUCTION_MAX_LENGTH}
          placeholder="Write your answer..."
          className={[customTextareaBase, "mt-3", error ? invalidClass : ""].join(" ")}
          aria-label={resolvedPrompt}
          aria-invalid={Boolean(error)}
        />
        <div className="mt-1 text-right text-[10px] tabular-nums text-white/35">
          {(answer.response || "").length}/{CUSTOM_INSTRUCTION_MAX_LENGTH}
        </div>

        {links.length ? (
          <div className="mt-3 space-y-2">
            {links.map((link, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="url"
                  value={link}
                  onChange={(event) => {
                    const next = [...links];
                    next[idx] = event.target.value;
                    update({ links: next });
                  }}
                  placeholder="https://..."
                  className={[inputBase, "flex-1"].join(" ")}
                  aria-label={`Screener link ${idx + 1}`}
                />
                <button
                  type="button"
                  onClick={() => update({ links: links.filter((_, i) => i !== idx) })}
                  className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/6 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label={`Remove link ${idx + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => update({ links: [...links, ""] })}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-white/50 transition-colors hover:text-white/78"
        >
          <Icon name="plus" className="h-3 w-3" />
          Add link
        </button>
      </div>
    </div>
  );
}

/**
 * Requester-facing completion of the structured first-message requirements an
 * owner chose. Each answer type renders its own field; errors render inline.
 */
export default function FirstMessageFields({
  context,
  requirementKeys,
  answers,
  onChange,
  errors = {},
  portfolio,
  requirementPrompts,
}: {
  context: RequirementContext;
  requirementKeys: string[];
  answers: FirstMessageAnswers;
  onChange: (next: FirstMessageAnswers) => void;
  errors?: Record<string, string>;
  portfolio?: PortfolioState;
  requirementPrompts?: Record<string, string>;
}) {
  const keys = sanitizeRequirementKeys(requirementKeys, context);
  if (!keys.length) return null;

  const setAnswer = (key: string, value: RequirementAnswerValue) => {
    onChange({ ...answers, [key]: value });
  };

  return (
    <div className="space-y-4">
      {keys.map((key) => {
        const def = getRequirementDef(key);
        const copy = def ? requirementCopy(def, context) : null;
        if (!def || !copy) return null;
        const error = errors[key];
        const value = answers[key] ?? emptyAnswerFor(def, context);
        const contextualPrompt = requirementPrompts?.[key]?.trim();

        if (key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY) {
          return (
            <CustomInstructionField
              key={key}
              value={value}
              prompt={contextualPrompt}
              error={error}
              onChange={(next) => setAnswer(key, next)}
            />
          );
        }

        if (def.answerType === "currency") {
          const v: CurrencyAnswer = isCurrencyAnswer(value) ? value : { amount: "", unit: copy.units?.[0] ?? "" };
          return (
            <FieldShell key={key} dataKey={key} icon={def.icon} label={copy.requester} error={error}>
              <div className="flex gap-2">
                <div className={["flex flex-1 items-center rounded-xl bg-white/6 border px-3 transition-colors focus-within:border-white/25 focus-within:bg-white/7", error ? "border-amber-200/40" : "border-white/10"].join(" ")}>
                  <span className="pointer-events-none mr-0.5 text-sm text-white/45">₹</span>
                  <input
                    inputMode="numeric"
                    value={v.amount}
                    onChange={(e) => setAnswer(key, { ...v, amount: e.target.value.replace(/[^\d,.]/g, "") })}
                    placeholder="25,000"
                    // The global keyboard-focus ring (globals.css `:focus-visible`) is written
                    // *unlayered*, so under Tailwind v4 cascade layers a `focus-visible:outline-none`
                    // utility (in @layer utilities) can't beat it — it would draw a rounded box
                    // *inside* this bordered wrapper, to the right of ₹ (the "box-in-box"). An inline
                    // style outranks any selector rule, so it reliably removes that inner ring; the
                    // wrapper owns the focus treatment via `focus-within`, giving one continuous field.
                    style={{ outline: "none" }}
                    className="h-11 w-full bg-transparent text-sm text-white placeholder:text-white/35"
                  />
                </div>
                {copy.units?.length ? (
                  <select className={selectBase} value={v.unit} onChange={(e) => setAnswer(key, { ...v, unit: e.target.value })}>
                    {copy.units.map((u) => (
                      <option key={u} value={u} className="bg-[#0b0b0f]">
                        {u}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </FieldShell>
          );
        }

        if (def.answerType === "turnaround") {
          const v: TurnaroundAnswer = isTurnaroundAnswer(value) ? value : { value: "", unit: "days" };
          return (
            <FieldShell key={key} dataKey={key} icon={def.icon} label={copy.requester} error={error}>
              <div className="flex gap-2">
                <input
                  inputMode="numeric"
                  value={v.value}
                  onChange={(e) => setAnswer(key, { ...v, value: e.target.value.replace(/[^\d]/g, "") })}
                  placeholder="3"
                  className={[inputBase, "flex-1", error ? invalidClass : ""].join(" ")}
                />
                <select className={selectBase} value={v.unit} onChange={(e) => setAnswer(key, { ...v, unit: e.target.value as TurnaroundAnswer["unit"] })}>
                  {TURN_UNITS.map((u) => (
                    <option key={u} value={u} className="bg-[#0b0b0f]">
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </FieldShell>
          );
        }

        if (def.answerType === "portfolio") {
          const v: PortfolioRef[] = isPortfolioAnswer(value) ? value : [];
          return (
            <FieldShell key={key} dataKey={key} icon={def.icon} label={copy.requester} error={error}>
              <PortfolioPicker selected={v} onChange={(next) => setAnswer(key, next)} portfolio={portfolio} placeholder={copy.placeholder} />
            </FieldShell>
          );
        }

        if (def.answerType === "tools") {
          const v: string[] = isStringArray(value) ? value : [];
          return (
            <FieldShell key={key} dataKey={key} icon={def.icon} label={copy.requester} error={error} hint={copy.placeholder}>
              <ToolPicker value={v} onChange={(next) => setAnswer(key, next)} placeholder={copy.placeholder} className="space-y-2.5" />
            </FieldShell>
          );
        }

        if (def.answerType === "multiLink") {
          // Accept the structured reference form (and mixes) too, editing as plain URLs.
          const arr: string[] = Array.isArray(value)
            ? (value as Array<string | ReferenceLink>).map(referenceLinkUrl).filter(Boolean)
            : [];
          const rows = arr.length ? arr : [""];
          return (
            <FieldShell key={key} dataKey={key} icon={def.icon} label={copy.requester} error={error}>
              <div className="space-y-2">
                {rows.map((row, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      type="url"
                      value={row}
                      onChange={(e) => {
                        const copyRows = [...rows];
                        copyRows[idx] = e.target.value;
                        setAnswer(key, copyRows);
                      }}
                      placeholder={copy.placeholder || "https://…"}
                      className={[inputBase, "flex-1", error && !row.trim() ? invalidClass : ""].join(" ")}
                    />
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setAnswer(key, rows.filter((_, i) => i !== idx))}
                        className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/6 text-white/60 hover:bg-white/10 hover:text-white"
                        aria-label="Remove link"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setAnswer(key, [...rows, ""])}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-white/55 transition-colors hover:text-white/80"
                >
                  <Icon name="plus" className="h-3 w-3" /> Add another link
                </button>
              </div>
            </FieldShell>
          );
        }

        if (def.answerType === "link") {
          const v = typeof value === "string" ? value : "";
          return (
            <FieldShell key={key} dataKey={key} icon={def.icon} label={copy.requester} error={error}>
              <input
                type="url"
                value={v}
                onChange={(e) => setAnswer(key, e.target.value)}
                placeholder={copy.placeholder || "https://…"}
                className={[inputBase, error ? invalidClass : ""].join(" ")}
              />
            </FieldShell>
          );
        }

        if (def.answerType === "select" && copy.options?.length) {
          const v = typeof value === "string" ? value : "";
          return (
            <FieldShell key={key} dataKey={key} icon={def.icon} label={copy.requester} error={error}>
              <select className={[selectBase, "w-full", error ? invalidClass : ""].join(" ")} value={v} onChange={(e) => setAnswer(key, e.target.value)}>
                <option value="" className="bg-[#0b0b0f]">
                  Choose…
                </option>
                {copy.options.map((o) => (
                  <option key={o} value={o} className="bg-[#0b0b0f]">
                    {o}
                  </option>
                ))}
              </select>
            </FieldShell>
          );
        }

        if (def.answerType === "availability" || def.answerType === "startDate") {
          const v = typeof value === "string" ? value : "";
          return (
            <FieldShell key={key} dataKey={key} icon={def.icon} label={copy.requester} error={error}>
              <input
                value={v}
                onChange={(e) => setAnswer(key, e.target.value)}
                placeholder={copy.placeholder || ""}
                className={[inputBase, error ? invalidClass : ""].join(" ")}
              />
              {copy.suggestions?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {copy.suggestions.map((s) => (
                    <button key={s} type="button" className={`${chip(v === s)} cursor-pointer`} onClick={() => setAnswer(key, v === s ? "" : s)}>
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </FieldShell>
          );
        }

        // longText, experience, text
        const v = typeof value === "string" ? value : "";
        const multiline = def.answerType === "longText" || def.answerType === "experience";
        return (
          <FieldShell
            key={key}
            dataKey={key}
            icon={def.icon}
            label={copy.requester}
            error={error}
            hint={key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY ? contextualPrompt || copy.placeholder : undefined}
          >
            {multiline ? (
              <textarea
                value={v}
                onChange={(e) => setAnswer(key, e.target.value)}
                placeholder={copy.placeholder || ""}
                className={[textareaBase, error ? invalidClass : ""].join(" ")}
              />
            ) : (
              <input
                value={v}
                onChange={(e) => setAnswer(key, e.target.value)}
                placeholder={copy.placeholder || ""}
                className={[inputBase, error ? invalidClass : ""].join(" ")}
              />
            )}
          </FieldShell>
        );
      })}
    </div>
  );
}
