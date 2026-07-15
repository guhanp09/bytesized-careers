"use client";

// Post-import banner shown above the Post Job form (plan D6/D12). Review status
// lives here — never as amber validation styling on fields. Jump pills reuse the
// wizard's own step-switch + focus mechanics via the onJumpTo callback.

import React from "react";
import { Icon } from "../Icons";
import {
  IMPORT_FIELD_LABELS,
  IMPORT_JUMP_TARGETS,
  IMPORT_PUBLISH_RELEVANT_KEYS,
} from "../../lib/importJob/applyToWizard";
import type { ImportFieldKey, ImportFieldMeta } from "../../lib/importJob/types";

const VISIBLE_PILLS = 8;

export default function ImportReviewBanner({
  meta,
  onJumpTo,
  onGoToPublish,
  onDismiss,
}: {
  meta: ImportFieldMeta;
  onJumpTo: (key: ImportFieldKey) => void;
  onGoToPublish: () => void;
  onDismiss: () => void;
}) {
  const [showAll, setShowAll] = React.useState(false);

  const entries = Object.entries(meta) as Array<[ImportFieldKey, NonNullable<ImportFieldMeta[ImportFieldKey]>]>;
  const needsLook = entries.filter(([, m]) => m.status === "review" || m.status === "conflict");
  const missingRequired = entries.filter(
    ([key, m]) => m.status === "missing" && IMPORT_PUBLISH_RELEVANT_KEYS.includes(key)
  );
  const attention = [...needsLook, ...missingRequired].filter(([key]) => IMPORT_JUMP_TARGETS[key]);
  const publishReady = missingRequired.length === 0 && !needsLook.some(([key]) => IMPORT_PUBLISH_RELEVANT_KEYS.includes(key));

  const visible = showAll ? attention : attention.slice(0, VISIBLE_PILLS);
  const hiddenCount = attention.length - visible.length;

  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"
      data-testid="import-review-banner"
      aria-label="Imported from your post"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-white/60">
          <Icon name="file" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Imported from your post.</p>
          <p className="mt-0.5 text-sm text-white/60">
            {attention.length > 0
              ? `${attention.length} detail${attention.length === 1 ? "" : "s"} need a look before you publish.`
              : "You're ready to publish. Review anything you like, then post."}
          </p>
          {attention.length > 0 || publishReady ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {visible.map(([key]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onJumpTo(key)}
                  className="ui-press h-8 cursor-pointer rounded-lg border border-white/12 bg-white/7 px-2.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  data-testid={`import-banner-jump-${key}`}
                >
                  {IMPORT_FIELD_LABELS[key]}
                </button>
              ))}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="h-8 cursor-pointer rounded-lg px-2 text-xs font-semibold text-white/50 transition-colors hover:text-white"
                >
                  Show all ({attention.length})
                </button>
              ) : null}
              {publishReady ? (
                <button
                  type="button"
                  onClick={onGoToPublish}
                  className="ui-press h-8 cursor-pointer rounded-lg bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-white/90"
                  data-testid="import-banner-go-to-publish"
                >
                  Go to publish
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-white/50 transition-colors hover:text-white"
          aria-label="Dismiss import summary"
          data-testid="import-banner-dismiss"
        >
          Got it
        </button>
      </div>
    </section>
  );
}
