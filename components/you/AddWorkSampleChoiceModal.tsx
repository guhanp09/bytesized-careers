"use client";

import { useEffect, useState } from "react";

import type { BackendPortfolioLinkPreviewResponse } from "../../lib/backendClient";
import { Icon } from "../Icons";

export type WorkSampleSourceType =
  | "youtube"
  | "custom"
  | "website"
  | "drive"
  | "behance"
  | "instagram"
  | "vimeo"
  | "other";

export type WorkSampleAction =
  {
    mode: "link";
    sourceKind:
      | "youtube"
      | "vimeo"
      | "drive"
      | "docs"
      | "notion"
      | "behance"
      | "instagram"
      | "tiktok"
      | "figma"
      | "canva"
      | "dropbox"
      | "website"
      | "external";
    sourceType: WorkSampleSourceType;
    suggestedTitle?: string;
    url: string;
    preview?: BackendPortfolioLinkPreviewResponse;
    previewError?: string;
  };

type WorkSampleLinkAction = Extract<WorkSampleAction, { mode: "link" }>;

type AddWorkSampleChoiceModalProps = {
  onClose: () => void;
  onChoose: (action: WorkSampleAction) => void;
  onPreviewLink: (url: string) => Promise<BackendPortfolioLinkPreviewResponse>;
  /**
   * Raise the modal above another open modal (e.g. the job-application popup) so it
   * stacks cleanly when launched in-flow. Default keeps the standalone /you z-index.
   */
  elevated?: boolean;
};

const normalizeWorkUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).href;
  } catch {
    return null;
  }
};

const detectSource = (url: string): WorkSampleLinkAction | null => {
  const normalizedUrl = normalizeWorkUrl(url);
  if (!normalizedUrl) return null;

  const parsed = new URL(normalizedUrl);
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    return {
      mode: "link",
      sourceKind: "youtube",
      sourceType: "youtube",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host.endsWith("vimeo.com")) {
    return {
      mode: "link",
      sourceKind: "vimeo",
      sourceType: "vimeo",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host === "drive.google.com") {
    return {
      mode: "link",
      sourceKind: "drive",
      sourceType: "drive",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host === "docs.google.com") {
    return {
      mode: "link",
      sourceKind: "docs",
      sourceType: "drive",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host.endsWith("notion.so") || host.endsWith("notion.site")) {
    return {
      mode: "link",
      sourceKind: "notion",
      sourceType: "custom",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host.endsWith("behance.net")) {
    return {
      mode: "link",
      sourceKind: "behance",
      sourceType: "behance",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host.endsWith("instagram.com")) {
    return {
      mode: "link",
      sourceKind: "instagram",
      sourceType: "instagram",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host.endsWith("tiktok.com")) {
    return {
      mode: "link",
      sourceKind: "tiktok",
      sourceType: "other",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host.endsWith("figma.com")) {
    return {
      mode: "link",
      sourceKind: "figma",
      sourceType: "custom",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host.endsWith("canva.com")) {
    return {
      mode: "link",
      sourceKind: "canva",
      sourceType: "custom",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  if (host.endsWith("dropbox.com")) {
    return {
      mode: "link",
      sourceKind: "dropbox",
      sourceType: "drive",
      suggestedTitle: "",
      url: normalizedUrl,
    };
  }

  return {
    mode: "link",
    sourceKind: "external",
    sourceType: "custom",
    suggestedTitle: "",
    url: normalizedUrl,
  };
};

const previewFailureMessage = (sourceKind: WorkSampleLinkAction["sourceKind"]) => {
  if (sourceKind === "docs") {
    return "We couldn't fetch all details from this Google Docs link. The file may be private or restricted. Make sure it is set to \"Anyone with the link can view,\" or continue by filling details manually.";
  }
  if (sourceKind === "drive" || sourceKind === "dropbox") {
    return "We couldn't fetch all details from this Google Drive link. The file may be private or restricted. Make sure it is set to \"Anyone with the link can view,\" or continue by filling details manually.";
  }
  if (sourceKind === "youtube") {
    return "YouTube details could not be fetched right now. You can still continue by filling the details manually.";
  }
  return "Details from this link could not be fetched. You can still continue by filling the details manually.";
};

const URL_PLACEHOLDER_EXAMPLES = [
  "https://youtube.com/watch?v=...",
  "https://behance.net/gallery/...",
  "https://drive.google.com/file/d/...",
  "https://figma.com/design/...",
  "https://instagram.com/reel/...",
  "https://notion.site/...",
];

export default function AddWorkSampleChoiceModal({ onClose, onChoose, onPreviewLink, elevated = false }: AddWorkSampleChoiceModalProps) {
  const [workLink, setWorkLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fetchingPreview, setFetchingPreview] = useState(false);
  const [animatedUrlPlaceholder, setAnimatedUrlPlaceholder] = useState("");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const displayedPlaceholder = workLink
    ? ""
    : prefersReducedMotion
      ? URL_PLACEHOLDER_EXAMPLES[0]
      : animatedUrlPlaceholder;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);
    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion || workLink.trim()) {
      return;
    }

    let exampleIndex = 0;
    let charIndex = 0;
    let phase: "typing" | "pausing" | "deleting" = "typing";
    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      const example = URL_PLACEHOLDER_EXAMPLES[exampleIndex];

      if (phase === "typing") {
        charIndex += 1;
        setAnimatedUrlPlaceholder(example.slice(0, charIndex));
        if (charIndex >= example.length) {
          phase = "pausing";
          timeoutId = setTimeout(tick, 1300);
          return;
        }
        timeoutId = setTimeout(tick, 52);
        return;
      }

      if (phase === "pausing") {
        phase = "deleting";
        timeoutId = setTimeout(tick, 120);
        return;
      }

      charIndex = Math.max(0, charIndex - 2);
      setAnimatedUrlPlaceholder(example.slice(0, charIndex));
      if (charIndex === 0) {
        exampleIndex = (exampleIndex + 1) % URL_PLACEHOLDER_EXAMPLES.length;
        phase = "typing";
        timeoutId = setTimeout(tick, 360);
        return;
      }
      timeoutId = setTimeout(tick, 30);
    };

    timeoutId = setTimeout(tick, 260);
    return () => clearTimeout(timeoutId);
  }, [prefersReducedMotion, workLink]);

  const handleContinue = async () => {
    const detected = detectSource(workLink);
    if (!detected) {
      setError("Paste a valid Project URL to continue.");
      return;
    }
    setError(null);
    setFetchingPreview(true);
    try {
      const preview = await onPreviewLink(detected.url);
      setFetchingPreview(false);
      onChoose({ ...detected, preview });
    } catch {
      setFetchingPreview(false);
      onChoose({
        ...detected,
        previewError: previewFailureMessage(detected.sourceKind),
      });
    }
  };

  return (
    <div className={`ui-modal-backdrop fixed inset-0 ${elevated ? "z-[70]" : "z-50"} flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm`}>
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close add project dialog"
        onClick={onClose}
      />
      <section className="ui-modal-panel relative w-full max-w-xl rounded-3xl border border-white/12 bg-[#18191d] p-5 shadow-[0_30px_110px_-42px_rgba(0,0,0,1)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white">Add project</h2>
            <p className="mt-1 text-sm leading-relaxed text-white/58">
              Paste a project URL. We&apos;ll fetch what we can.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="Close"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-white/56">Project URL</span>
            <input
              value={workLink}
              onChange={(event) => {
                setWorkLink(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleContinue();
                }
              }}
              className="mt-2 h-12 w-full rounded-2xl border border-white/12 bg-white/[0.045] px-4 text-sm text-white outline-none transition-colors placeholder:text-subtle focus:border-white/24 focus:bg-white/[0.065]"
              placeholder={displayedPlaceholder}
              autoFocus
            />
          </label>
          {error ? (
            <p className="rounded-xl border border-amber-200/20 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
              {error}
            </p>
          ) : null}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void handleContinue()}
              disabled={fetchingPreview}
              className="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {fetchingPreview ? "Fetching preview..." : "Continue"}
            </button>
            <p className="text-xs leading-relaxed text-subtle">
              Use a public or shareable URL. You can fill in missing details after preview.
            </p>
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            YouTube · Vimeo · Google Drive · Google Docs · Notion · Behance · Instagram · Figma · Canva
          </p>
          <p className="text-xs leading-relaxed text-subtle">
            Portfolio sites and other public URLs also work.
          </p>
        </div>
      </section>
    </div>
  );
}
