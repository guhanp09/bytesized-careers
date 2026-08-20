"use client";

import type { BackendPortfolioItem } from "../../lib/backendClient";
import {
  buildPortfolioTimestampUrl,
  formatPortfolioTimestamp,
  getPortfolioHighlights,
  getPortfolioProjectUrl,
  getPortfolioTimestampNotes,
  getPortfolioTools,
  getPortfolioWhatIDid,
} from "../../lib/portfolioDetails";
import { resolveToolDisplay } from "../../lib/toolCatalog";
import { Icon } from "../Icons";
import {
  AnchoredGlassPopover,
  GlassDetailSection,
  useAnchoredGlassPopover,
} from "../ui/AnchoredGlassPopover";

const cleanText = (value?: string | null) => {
  const cleaned = value?.trim();
  return cleaned || null;
};

const formatDateShort = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

function ToolToken({ toolName }: { toolName: string }) {
  const tool = resolveToolDisplay(toolName);
  if (!tool.inputName) return null;

  return (
    <span
      className="inline-flex max-w-full items-center gap-2 text-sm font-medium leading-none text-white/70"
      title={tool.known ? tool.displayName : `${tool.inputName} (custom tool)`}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.055] text-[10px] font-semibold text-white/78"
      >
        {tool.iconName ? (
          <Icon name={tool.iconName} className="h-4 w-4" />
        ) : (
          <span className="translate-y-px">{tool.initials}</span>
        )}
      </span>
      <span className="min-w-0 truncate">{tool.displayName || tool.inputName}</span>
    </span>
  );
}

export function usePortfolioDetailPopup(popoverId = "portfolio-detail-popup") {
  const popup = useAnchoredGlassPopover<BackendPortfolioItem>({ desktopWidth: 900, preferredHeight: 760 });

  return {
    activeItem: popup.activeItem,
    activeItemId: popup.activeItem?.id || null,
    open: popup.open,
    close: popup.close,
    popover: (
      <PortfolioDetailPopup
        item={popup.activeItem}
        position={popup.position}
        popoverRef={popup.popoverRef}
        popoverId={popoverId}
        onClose={popup.close}
      />
    ),
    popoverId,
  };
}

function PortfolioDetailPopup({
  item,
  position,
  popoverRef,
  popoverId,
  onClose,
}: {
  item: BackendPortfolioItem | null;
  position: Parameters<typeof AnchoredGlassPopover>[0]["position"];
  popoverRef: Parameters<typeof AnchoredGlassPopover>[0]["popoverRef"];
  popoverId: string;
  onClose: () => void;
}) {
  const projectUrl = item ? getPortfolioProjectUrl(item) : null;
  const whatIDid = item ? getPortfolioWhatIDid(item) : null;
  const highlights = item ? getPortfolioHighlights(item) : [];
  const timestampNotes = item ? getPortfolioTimestampNotes(item) : [];
  const tools = item ? getPortfolioTools(item) : [];
  const role = item ? cleanText(item.role_name || item.role || item.user_role_in_project) : null;
  const source = item ? cleanText(item.channel_name) || cleanText(item.source_type) : null;
  const date = item ? formatDateShort(item.published_at || item.published_date || item.created_at) : null;
  const metaItems = [role, source, date].filter(Boolean);
  const showWhatIDid = Boolean(role || whatIDid);

  return (
    <AnchoredGlassPopover
      active={Boolean(item)}
      position={position}
      popoverRef={popoverRef}
      popoverId={popoverId}
      ariaLabel={item ? `Portfolio project details: ${item.title}` : "Portfolio project details"}
      closeLabel="Close portfolio project details"
      onClose={onClose}
    >
      {item ? (
        <>
          <div className="grid gap-5 pr-12 sm:grid-cols-[minmax(240px,360px)_minmax(0,1fr)] sm:gap-7">
            <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_18px_55px_-38px_rgba(0,0,0,1)]">
              {item.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnail_url}
                  alt=""
                  loading="eager"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-subtle">
                  <Icon name="image" className="h-8 w-8" />
                </div>
              )}
            </div>
            <div className="min-w-0 sm:pt-2">
              <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[28px]">
                {item.title}
              </h2>
              {metaItems.length ? (
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-muted">
                  {metaItems.map((meta, index) => (
                    <span key={`${meta}-${index}`} className="inline-flex items-center gap-3">
                      {index > 0 ? <span aria-hidden className="h-1 w-1 rounded-full bg-white/24" /> : null}
                      {meta}
                    </span>
                  ))}
                </div>
              ) : null}
              {projectUrl ? (
                <a
                  href={projectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open project externally: ${item.title}`}
                  className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm font-semibold text-white/64 transition-colors hover:border-white/18 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/18"
                >
                  Open project
                  <Icon name="external-link" className="h-4 w-4" />
                </a>
              ) : null}
            </div>
          </div>

          {showWhatIDid ? (
            <GlassDetailSection title="What I Did" icon="users">
              {role ? <p className="mb-3 text-lg font-semibold text-violet-300">{role}</p> : null}
              {whatIDid ? (
                <p className="max-w-[72ch] text-base leading-8 text-white/72">{whatIDid}</p>
              ) : null}
            </GlassDetailSection>
          ) : null}

          {highlights.length ? (
            <GlassDetailSection title="Contribution Highlights" icon="bolt">
              <ul className="space-y-3 text-base leading-7 text-white/68">
                {highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-4">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300/85 shadow-[0_0_16px_rgba(196,181,253,0.35)]" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </GlassDetailSection>
          ) : null}

          {timestampNotes.length ? (
            <GlassDetailSection title="Timestamp Notes" icon="clock">
              <div className="space-y-4">
                {timestampNotes.map((note, idx) => {
                  const label = note.time || formatPortfolioTimestamp(note.seconds);
                  const timestampUrl = projectUrl ? buildPortfolioTimestampUrl(projectUrl, note.seconds) : null;
                  const noteKey = note.id || `${note.seconds}-${idx}`;
                  return (
                    <div
                      key={noteKey}
                      className="grid gap-2 sm:grid-cols-[112px_minmax(140px,190px)_minmax(0,1fr)] sm:gap-5"
                    >
                      {timestampUrl ? (
                        <a
                          href={timestampUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open project at ${note.seconds} seconds: ${note.title}`}
                          className="group inline-flex w-fit cursor-pointer items-center gap-2 text-base font-semibold text-violet-300 transition-colors hover:text-violet-200 focus:outline-none focus:ring-2 focus:ring-white/18"
                        >
                          <span>{label}</span>
                          <Icon name="external-link" className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </a>
                      ) : (
                        <span className="text-base font-semibold text-muted">{label}</span>
                      )}
                      <p className="min-w-0 text-base font-semibold leading-7 text-white/86">{note.title}</p>
                      {note.description ? (
                        <p className="min-w-0 text-sm leading-7 text-white/58 sm:text-base">{note.description}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </GlassDetailSection>
          ) : null}

          {tools.length ? (
            <GlassDetailSection title="Tools Used" icon="sliders-horizontal">
              <div className="flex flex-wrap gap-x-6 gap-y-4">
                {tools.map((tool) => (
                  <ToolToken key={tool} toolName={tool} />
                ))}
              </div>
            </GlassDetailSection>
          ) : null}
        </>
      ) : null}
    </AnchoredGlassPopover>
  );
}
