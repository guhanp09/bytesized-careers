"use client";

import { useEffect } from "react";
import { ENABLE_SMART_TYPING } from "../lib/smartTyping/config";

const SPACE_TRIGGERS = new Set([",", ".", "?", "!", ":", ";", ")", "]", "}", "\"", "'"]);
const SENTENCE_END = new Set([".", "?", "!"]);
const CLOSERS = new Set([")", "]", "}", "\"", "'"]);
const CLOSE_PUNCT = new Set([",", ".", "?", "!", ":", ";", ")", "]", "}", "\"", "'"]);
const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "vs",
]);

const isTextTarget = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement => {
  if (!target) return false;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLInputElement) {
    if (target.readOnly || target.disabled) return false;
    const type = (target.type || "text").toLowerCase();
    const mode = (target.inputMode || "").toLowerCase();
    if (mode === "numeric" || mode === "decimal") return false;
    return ![
      "button",
      "checkbox",
      "color",
      "date",
      "datetime-local",
      "file",
      "hidden",
      "image",
      "month",
      "number",
      "radio",
      "range",
      "reset",
      "submit",
      "time",
      "week",
    ].includes(type);
  }
  return false;
};

const isAlpha = (value: string) => /^[a-z]$/i.test(value);
const isWhitespace = (value: string) => value === " " || value === "\t";

const getTokenBefore = (value: string, index: number) => {
  const left = value.slice(0, index);
  const match = left.match(/([^\s]+)$/);
  return match ? match[1] : "";
};

const looksCodeLike = (token: string) => {
  if (!token) return false;
  const lower = token.toLowerCase();
  if (lower.includes("://") || lower.startsWith("www.")) return true;
  if (lower.includes("@")) return true;
  if (/[\/\\_]/.test(token)) return true;
  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(token)) return true;
  return false;
};

const isAbbreviationToken = (token: string) => {
  const clean = token.toLowerCase().replace(/[^a-z.]/g, "").replace(/\.$/, "");
  return ABBREVIATIONS.has(clean);
};

const isDecimalOrVersion = (token: string) => {
  const clean = token.replace(/[^0-9v.]/gi, "");
  if (!clean) return false;
  if (/^[vV]?\d+$/.test(clean)) return true;
  if (/^[vV]?\d+(?:\.\d+)+$/.test(clean)) return true;
  return false;
};

const getPrevMeaningful = (value: string, index: number) => {
  let i = index - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "\n") {
      return { ch, index: i };
    }
    if (isWhitespace(ch)) {
      i -= 1;
      continue;
    }
    if (CLOSERS.has(ch)) {
      i -= 1;
      continue;
    }
    return { ch, index: i };
  }
  return { ch: "", index: -1 };
};

const isAbbreviationEnd = (value: string, index: number) => {
  const token = getTokenBefore(value, index);
  return isAbbreviationToken(token);
};

const isDecimalOrVersionEnd = (value: string, index: number) => {
  const token = getTokenBefore(value, index);
  return isDecimalOrVersion(token);
};

const shouldCapitalize = (value: string, index: number) => {
  if (index === 0) return true;
  const prevChar = value[index - 1] || "";
  if (isAlpha(prevChar)) return false;
  const prevMeaningful = getPrevMeaningful(value, index);
  if (!prevMeaningful.ch) return true;
  if (prevMeaningful.ch === "\n") return true;
  if (SENTENCE_END.has(prevMeaningful.ch)) {
    if (isAbbreviationEnd(value, prevMeaningful.index)) return false;
    if (isDecimalOrVersionEnd(value, prevMeaningful.index)) return false;
    return true;
  }
  return false;
};

const shouldAutoSpaceAfterPunct = (value: string, index: number, data: string) => {
  const nextChar = value[index] || "";
  if (!nextChar) return false;
  if (isWhitespace(nextChar) || nextChar === "\n") return false;
  if (CLOSE_PUNCT.has(nextChar)) return false;

  const token = getTokenBefore(value, index);
  if (looksCodeLike(token)) return false;

  if (data === ".") {
    if (value[index - 1] === ".") return false;
    if (isDecimalOrVersion(token)) return false;
    if (isAbbreviationToken(token)) return false;
  }

  if (data === "'" || data === "\"") {
    const prev = value[index - 1] || "";
    const next = value[index] || "";
    if (isAlpha(prev) && isAlpha(next)) return false;
  }

  return true;
};

const needsSpaceBeforeLetter = (value: string, index: number) => {
  const prev = value[index - 1] || "";
  if (!prev || isWhitespace(prev) || prev === "\n") return false;
  if (CLOSERS.has(prev)) {
    const beforeCloser = value[index - 2] || "";
    if (prev === "'" && isAlpha(beforeCloser)) return false;
    if (!beforeCloser || isWhitespace(beforeCloser) || beforeCloser === "\n") return false;
    return true;
  }
  if (SENTENCE_END.has(prev) || [",", ":", ";"].includes(prev)) {
    const token = getTokenBefore(value, index - 1);
    if (looksCodeLike(token)) return false;
    if (prev === "." && (isDecimalOrVersion(token) || isAbbreviationToken(token))) return false;
    if (prev === "." && value[index - 2] === ".") return false;
    return true;
  }
  return false;
};

const insertText = (target: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  if (document.queryCommandSupported?.("insertText")) {
    document.execCommand("insertText", false, text);
    return;
  }
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? start;
  target.setRangeText(text, start, end, "end");
  const event = new InputEvent("input", { bubbles: true, inputType: "insertText", data: text });
  target.dispatchEvent(event);
};

export default function SmartTypingProvider() {
  useEffect(() => {
    if (!ENABLE_SMART_TYPING) return;

    const autoSpaceMap = new WeakMap<
      HTMLTextAreaElement | HTMLInputElement,
      { pos: number; time: number }
    >();

    const handleBeforeInput = (event: Event) => {
      const e = event as InputEvent;
      if (!ENABLE_SMART_TYPING) return;
      if (e.isComposing) return;
      if (e.inputType !== "insertText") return;
      const data = e.data ?? "";
      if (!data) return;

      const target = e.target;
      if (!isTextTarget(target)) return;

      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? 0;
      if (start !== end) return;

      if (data === " ") {
        const last = autoSpaceMap.get(target);
        if (last && last.pos === start && Date.now() - last.time < 800) {
          e.preventDefault();
          autoSpaceMap.delete(target);
          return;
        }
      }

      const value = target.value;

      if (SPACE_TRIGGERS.has(data)) {
        if (shouldAutoSpaceAfterPunct(value, start, data)) {
          e.preventDefault();
          insertText(target, `${data} `);
          autoSpaceMap.set(target, { pos: start + 2, time: Date.now() });
        }
        return;
      }

      if (isAlpha(data)) {
        const spaceBefore = needsSpaceBeforeLetter(value, start);
        const nextCaps = shouldCapitalize(value, start);
        const nextChar = nextCaps ? data.toUpperCase() : data;

        if (spaceBefore || nextCaps) {
          e.preventDefault();
          insertText(target, `${spaceBefore ? " " : ""}${nextChar}`);
        }
      }
    };

    const handlePaste = (event: Event) => {
      const e = event as ClipboardEvent;
      if (!ENABLE_SMART_TYPING) return;
      const target = e.target;
      if (!isTextTarget(target)) return;
      const text = e.clipboardData?.getData("text");
      if (!text) return;
      e.preventDefault();
      const normalized = text.replace(/([,.;:!?])\s{2,}/g, "$1 ");
      insertText(target, normalized);
    };

    document.addEventListener("beforeinput", handleBeforeInput, true);
    document.addEventListener("paste", handlePaste, true);

    return () => {
      document.removeEventListener("beforeinput", handleBeforeInput, true);
      document.removeEventListener("paste", handlePaste, true);
    };
  }, []);

  return null;
}
