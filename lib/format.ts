import type { StartTimeframe } from "./types";

export function formatSubs(n: number | null) {
  if (n === null) return "Subs hidden";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M subs`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}K subs`;
  return `${n} subs`;
}

export function formatSubsInput(rawInput: string) {
  const raw = rawInput.replace(/,/g, "").trim();
  if (!raw) return "";
  const n = Number(raw);
  if (Number.isNaN(n)) return `${rawInput} subs`;
  return formatSubs(n);
}

export function formatCompactNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}K`;
  return `${n}`;
}

export function formatNumberWithCommas(n: number) {
  return n.toLocaleString("en-US");
}

export function formatBudgetPreview(minStr: string, maxStr: string, unit: "per project" | "per month") {
  const min = Number(minStr);
  const max = Number(maxStr);
  if (!minStr || !maxStr || Number.isNaN(min) || Number.isNaN(max)) return "";
  if (min === max) return `₹${formatNumberWithCommas(min)} ${unit}`;
  return `₹${formatNumberWithCommas(min)}–₹${formatNumberWithCommas(max)} ${unit}`;
}

export function formatExperiencePreview(minStr: string, maxStr: string) {
  const min = Number(minStr);
  const max = Number(maxStr);
  if (!minStr || !maxStr || Number.isNaN(min) || Number.isNaN(max)) return "";
  if (min === max) return `${min} years`;
  return `${min}–${max} years`;
}

export function onlyDigits(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function formatStartLabel(value: StartTimeframe) {
  switch (value) {
    case "ASAP":
      return "ASAP";
    case "<1mo":
      return "<1 mo";
    case "<2mo":
      return "<2 mo";
    case "<3mo":
      return "<3 mo";
    case "Flexible":
      return "Flexible";
  }
}

export function formatStartFilterLabel(value: StartTimeframe) {
  switch (value) {
    case "ASAP":
      return "ASAP";
    case "<1mo":
      return "1 month";
    case "<2mo":
      return "2 months";
    case "<3mo":
      return "3 months";
    case "Flexible":
      return "Flexible";
  }
}

export function formatStartBadge(value: StartTimeframe) {
  return `Start: ${formatStartLabel(value)}`;
}

export function formatPostedLabel(value?: string | null) {
  const raw = (value || "").trim().toLowerCase();
  if (!raw || raw === "now" || raw === "just now") return "just now";
  if (raw.includes("ago")) return value as string;
  const match = raw.match(/^(\d+)([mhd])$/);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2];
    const unitLabel =
      unit === "m" ? "minute" : unit === "h" ? "hour" : "day";
    const plural = amount === 1 ? "" : "s";
    return `${amount} ${unitLabel}${plural} ago`;
  }
  return value as string;
}
