// Pure reducer for the import page's UI flow (plan §5.2). Side effects (storage,
// parsing, navigation) live in the component; the reducer only encodes states,
// guards, and transitions so every path is unit-testable.

import { MAX_IMPORT_CHARS, truncateCodepoints } from "./normalize.ts";
import { categoryForRole } from "./categoryMap.ts";
import type { JobCategory } from "../types.ts";
import type { ImportParseResult } from "./types.ts";

export type ImportFlowState =
  | { phase: "paste"; text: string; truncatedAtLimit: boolean; restoredFromSession: boolean }
  | { phase: "analyzing"; text: string; truncatedAtLimit: boolean }
  | { phase: "notJobLikely"; text: string; truncatedAtLimit: boolean; result: ImportParseResult }
  | {
      phase: "review";
      text: string;
      truncatedAtLimit: boolean;
      result: ImportParseResult;
      chosenTitleIndex: number | null;
      /** null = uncertain category mapping awaiting an explicit selection (D13). */
      chosenCategory: JobCategory | null;
    }
  | { phase: "parseError"; text: string; truncatedAtLimit: boolean; message: string }
  | {
      phase: "handingOff";
      text: string;
      result: ImportParseResult;
      chosenTitleIndex: number | null;
      chosenCategory: JobCategory;
    };

export type ImportFlowEvent =
  | { type: "TEXT_CHANGED"; text: string }
  | { type: "RESTORE_SOURCE"; text: string }
  | { type: "ANALYZE" }
  | { type: "ANALYZE_DONE"; result: ImportParseResult }
  | { type: "ANALYZE_FAILED"; message: string }
  | { type: "PARSE_ANYWAY" }
  | { type: "SELECT_TITLE_ALTERNATIVE"; index: number }
  | { type: "SELECT_CATEGORY"; category: JobCategory }
  | { type: "BACK_TO_EDIT" }
  | { type: "CONTINUE_TO_EDITOR" }
  | { type: "RESET" };

export const initialImportFlowState: ImportFlowState = {
  phase: "paste",
  text: "",
  truncatedAtLimit: false,
  restoredFromSession: false,
};

/** Confident mappings pre-select the category; uncertain ones require a pick. */
export function seedCategory(result: ImportParseResult): JobCategory | null {
  const primaryRole = result.classification.rolesDetected[0] ?? null;
  const mapped = categoryForRole(primaryRole);
  const confident = mapped.confident && result.draft.title.status !== "conflict" && primaryRole !== null;
  return confident ? mapped.value : null;
}

/** The suggested (but uncommitted) chip for uncertain mappings. */
export function suggestedCategory(result: ImportParseResult, chosenTitleIndex: number | null): JobCategory {
  if (
    result.draft.title.status === "conflict" &&
    result.draft.title.alternatives &&
    chosenTitleIndex !== null
  ) {
    const chosen = result.draft.title.alternatives[chosenTitleIndex]?.value ?? "";
    return categoryForRole(chosen.toLowerCase()).value;
  }
  return categoryForRole(result.classification.rolesDetected[0] ?? null).value;
}

export function importFlowReducer(state: ImportFlowState, event: ImportFlowEvent): ImportFlowState {
  switch (event.type) {
    case "TEXT_CHANGED": {
      if (state.phase !== "paste") return state;
      // Truncate-and-retain (plan D20): keep the first 20k codepoints, flag it
      // persistently, and keep PREPARE DRAFT enabled.
      const overLimit = Array.from(event.text).length > MAX_IMPORT_CHARS;
      const text = overLimit ? truncateCodepoints(event.text, MAX_IMPORT_CHARS) : event.text;
      return {
        phase: "paste",
        text,
        truncatedAtLimit: state.truncatedAtLimit || overLimit,
        restoredFromSession: false,
      };
    }
    case "RESTORE_SOURCE": {
      if (state.phase !== "paste" || state.text.trim()) return state;
      return { phase: "paste", text: event.text, truncatedAtLimit: false, restoredFromSession: true };
    }
    case "ANALYZE": {
      if (state.phase !== "paste" || !state.text.trim()) return state;
      return { phase: "analyzing", text: state.text, truncatedAtLimit: state.truncatedAtLimit };
    }
    case "ANALYZE_DONE": {
      if (state.phase !== "analyzing") return state;
      if (!event.result.classification.looksLikeJobPost) {
        return {
          phase: "notJobLikely",
          text: state.text,
          truncatedAtLimit: state.truncatedAtLimit,
          result: event.result,
        };
      }
      return {
        phase: "review",
        text: state.text,
        truncatedAtLimit: state.truncatedAtLimit,
        result: event.result,
        chosenTitleIndex: event.result.draft.title.status === "conflict" ? 0 : null,
        chosenCategory: seedCategory(event.result),
      };
    }
    case "ANALYZE_FAILED": {
      if (state.phase !== "analyzing") return state;
      return {
        phase: "parseError",
        text: state.text,
        truncatedAtLimit: state.truncatedAtLimit,
        message: event.message,
      };
    }
    case "PARSE_ANYWAY": {
      if (state.phase !== "notJobLikely") return state;
      return {
        phase: "review",
        text: state.text,
        truncatedAtLimit: state.truncatedAtLimit,
        result: state.result,
        chosenTitleIndex: state.result.draft.title.status === "conflict" ? 0 : null,
        chosenCategory: seedCategory(state.result),
      };
    }
    case "SELECT_TITLE_ALTERNATIVE": {
      if (state.phase !== "review") return state;
      const alternatives = state.result.draft.title.alternatives ?? [];
      if (event.index < 0 || event.index >= alternatives.length) return state;
      // A new title recomputes the suggestion; explicit confirmation still stands
      // for uncertain mappings, so the committed choice resets.
      return { ...state, chosenTitleIndex: event.index, chosenCategory: seedCategory(state.result) };
    }
    case "SELECT_CATEGORY": {
      if (state.phase !== "review") return state;
      return { ...state, chosenCategory: event.category };
    }
    case "BACK_TO_EDIT": {
      if (state.phase === "review" || state.phase === "notJobLikely" || state.phase === "parseError") {
        return {
          phase: "paste",
          text: state.text,
          truncatedAtLimit: state.truncatedAtLimit,
          restoredFromSession: false,
        };
      }
      return state;
    }
    case "CONTINUE_TO_EDITOR": {
      if (state.phase !== "review") return state; // idempotent in handingOff
      if (state.chosenCategory === null) return state; // guard: uncertain category must be confirmed
      return {
        phase: "handingOff",
        text: state.text,
        result: state.result,
        chosenTitleIndex: state.chosenTitleIndex,
        chosenCategory: state.chosenCategory,
      };
    }
    case "RESET": {
      return { ...initialImportFlowState };
    }
    default:
      return state;
  }
}
