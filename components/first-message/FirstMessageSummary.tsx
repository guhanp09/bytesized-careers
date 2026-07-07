"use client";

import React from "react";
import {
  FirstMessageAnswers,
  RequirementContext,
  summarizeAnswers,
} from "../../lib/firstMessageRequirements";
import type { BackendPortfolioItem } from "../../lib/backendClient";
import { Icon } from "../Icons";
import { usePortfolioDetailPopup } from "../profile/PortfolioDetailPopup";

type SummaryLink = {
  id?: string;
  label: string;
  url?: string;
  kind?: "portfolio" | "link";
};

function portfolioItemFromSummaryLink(link: SummaryLink): BackendPortfolioItem {
  return {
    id: link.id || link.url || link.label,
    user_id: "first-message",
    title: link.label,
    source_type: "other",
    source_url: link.url || null,
    links: link.url ? [link.url] : [],
    tags: [],
    tools: [],
    status: "past",
    is_public: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

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
  const portfolioPopup = usePortfolioDetailPopup("first-message-portfolio-popup");
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
      <div className="space-y-2">
        {items.map((item) =>
          item.emphasis && item.text ? (
            <p key={item.key} className="flex items-center gap-2 text-sm font-semibold text-white/90">
              <Icon name={item.icon} className="h-4 w-4 shrink-0 text-white/50" />
              <span>{item.text}</span>
            </p>
          ) : (
            <div key={item.key} className="flex gap-2 text-[13px] leading-relaxed text-white/80">
              <Icon name={item.icon} className="mt-0.5 h-4 w-4 shrink-0 text-white/42" />
              <p className="min-w-0">
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
                    <span className="flex flex-col items-start gap-1.5">
                      {item.links.map((link, idx) =>
                        link.kind === "portfolio" ? (
                          <button
                            key={`${link.id ?? link.url ?? link.label}-${idx}`}
                            type="button"
                            onClick={(event) =>
                              portfolioPopup.open(
                                portfolioItemFromSummaryLink(link),
                                event.currentTarget,
                                { x: event.clientX, y: event.clientY }
                              )
                            }
                            className="inline-flex max-w-full cursor-pointer items-center gap-1.5 text-left font-medium text-blue-300 underline-offset-4 transition-colors hover:text-blue-200 hover:underline focus:outline-none focus:ring-2 focus:ring-white/18"
                          >
                            <span className="min-w-0 truncate">{link.label}</span>
                            <Icon name="external-link" className="h-3 w-3 shrink-0 opacity-70" />
                          </button>
                        ) : link.url ? (
                          <a
                            key={`${link.url}-${idx}`}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-full cursor-pointer items-center gap-1.5 font-medium text-blue-300 underline-offset-4 transition-colors hover:text-blue-200 hover:underline focus:outline-none focus:ring-2 focus:ring-white/18"
                          >
                            <span className="min-w-0 truncate">{link.label}</span>
                            <Icon name="external-link" className="h-3 w-3 shrink-0 opacity-70" />
                          </a>
                        ) : (
                          <span key={`${link.label}-${idx}`} className="text-blue-300">{link.label}</span>
                        )
                      )}
                    </span>
                  </>
                ) : (
                  <span className="whitespace-pre-wrap break-words text-white/85">{item.text}</span>
                )}
              </p>
            </div>
          )
        )}
      </div>
      {portfolioPopup.popover}
    </div>
  );
}
