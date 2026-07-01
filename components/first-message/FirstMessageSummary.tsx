"use client";

import React from "react";
import {
  FirstMessageAnswers,
  RequirementContext,
  summarizeAnswers,
} from "../../lib/firstMessageRequirements";

/**
 * Native rendering of a requester's structured opening-message answers — shown
 * directly beneath their message bubble in the inbox so the details read as part
 * of the same message, not a detached form result. Never renders raw JSON, field
 * keys, or a wrapper heading: each requirement is a compact "label · value" line,
 * the rate reads on its own, and links/portfolio stay clickable.
 *
 * Backward compatible: when there are no structured answers, it renders nothing,
 * so legacy free-text-only messages are unaffected.
 */
export default function FirstMessageSummary({
  context,
  answers,
  requirementKeys,
  className = "",
}: {
  context: RequirementContext;
  answers: FirstMessageAnswers | null | undefined;
  requirementKeys?: string[];
  className?: string;
}) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  const keys = requirementKeys?.length ? requirementKeys : Object.keys(answers);
  const items = summarizeAnswers(keys, context, answers);
  if (!items.length) return null;

  return (
    <div
      className={[
        "rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3.5 py-2.5",
        className,
      ].join(" ")}
    >
      <div className="space-y-1.5">
        {items.map((item) =>
          item.emphasis && item.text ? (
            <p key={item.key} className="text-sm font-semibold text-white/90">
              {item.text}
            </p>
          ) : (
            <p key={item.key} className="text-[13px] leading-relaxed text-white/80">
              <span className="text-white/42">{item.label}</span>
              <span className="text-white/25"> · </span>
              {item.links?.length ? (
                <>
                  {item.text ? (
                    <>
                      <span className="whitespace-pre-wrap break-words text-white/85">{item.text}</span>
                      <span className="block h-1.5" />
                    </>
                  ) : null}
                  {item.links.map((link, idx) => (
                    <React.Fragment key={`${link.url ?? link.label}-${idx}`}>
                      {idx > 0 ? <span className="text-white/25">, </span> : null}
                      {link.url ? (
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block max-w-[220px] translate-y-[0.1em] cursor-pointer truncate align-bottom text-white/85 underline-offset-4 transition-colors hover:text-white hover:underline"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <span className="text-white/85">{link.label}</span>
                      )}
                    </React.Fragment>
                  ))}
                </>
              ) : (
                <span className="whitespace-pre-wrap break-words text-white/85">{item.text}</span>
              )}
            </p>
          )
        )}
      </div>
    </div>
  );
}
