"use client";

import { safeExternalHref } from "../../lib/externalHref";
import { useState, type ReactNode } from "react";

import type { BackendProfileExperienceItem } from "../../lib/backendClient";
import {
  cleanExperienceText,
  experienceLinksForItem,
  formatExperienceDateRange,
  inferExperienceFromUrl,
  initialsForExperience,
  linkLabelForExperience,
  sortExperienceItems,
} from "../../lib/profileExperience";
import { Icon } from "../Icons";

function ExperienceIdentityMark({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl?: string | null;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = initialsForExperience(name);
  const cleanLogoUrl = cleanExperienceText(logoUrl);
  const failed = Boolean(cleanLogoUrl && failedUrl === cleanLogoUrl);

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] text-sm font-semibold text-white/62">
      {cleanLogoUrl && !failed ? (
        <img
          src={cleanLogoUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(cleanLogoUrl)}
          className="h-full w-full object-cover"
        />
      ) : initials ? (
        <span>{initials}</span>
      ) : (
        <Icon name="briefcase" className="h-4 w-4" />
      )}
    </div>
  );
}

function ExperienceIdentityAction({
  links,
  onOpenChoices,
  ariaLabel,
  children,
}: {
  links: ReturnType<typeof experienceLinksForItem>;
  onOpenChoices: () => void;
  ariaLabel?: string;
  children: ReactNode;
}) {
  if (!links.length) {
    return <>{children}</>;
  }

  if (links.length === 1) {
    const cleanHref = cleanExperienceText(links[0]?.url);
    if (!cleanHref) return <>{children}</>;
    return (
      <a
        href={cleanHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        className="inline-flex shrink-0 self-start cursor-pointer transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenChoices}
      aria-label={ariaLabel}
      className="inline-flex shrink-0 self-start cursor-pointer text-left transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      {children}
    </button>
  );
}

function ExperienceLinkDialog({
  organization,
  links,
  onClose,
}: {
  organization: string;
  links: ReturnType<typeof experienceLinksForItem>;
  onClose: () => void;
}) {
  if (!links.length) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="experience-links-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[24px] border border-white/12 bg-[#151517] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="experience-links-title" className="text-base font-semibold text-white">
              {organization}
            </h2>
            <p className="mt-1 text-sm text-muted">Choose where to open</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close organization links"
            className="cursor-pointer rounded-full p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {links.map((link) => (
            <a
              key={link.id}
              href={safeExternalHref(link.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/72 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                <Icon name="external-link" className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{link.platform || "Website"}</span>
                <span className="block truncate text-xs text-subtle">{linkLabelForExperience(link.url)}</span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export { sortExperienceItems } from "../../lib/profileExperience";

export default function ProfileExperienceList({
  items,
  emptyState,
  actions,
  editingItemId,
  renderEditingItem,
}: {
  items?: BackendProfileExperienceItem[] | null;
  emptyState?: ReactNode;
  actions?: (item: BackendProfileExperienceItem) => ReactNode;
  editingItemId?: string | null;
  renderEditingItem?: (item: BackendProfileExperienceItem, index: number) => ReactNode;
}) {
  const sortedItems = sortExperienceItems(items);
  const [activeLinkItemId, setActiveLinkItemId] = useState<string | null>(null);
  if (!sortedItems.length) {
    return emptyState ? <div>{emptyState}</div> : null;
  }

  return (
    <div className="space-y-0">
      {sortedItems.map((item, index) => {
        const organization = cleanExperienceText(item.organization_name) || "Creator team";
        const dateRange = formatExperienceDateRange(item);
        const secondaryMeta = [dateRange, cleanExperienceText(item.work_mode)]
          .filter(Boolean)
          .join(" · ");
        const tools = (item.tools || []).map((tool) => tool.trim()).filter(Boolean);
        const inferredLogoUrl = inferExperienceFromUrl(item.organization_url).suggestedLogoUrl;
        const organizationLinks = experienceLinksForItem(item);
        const itemKey = item.id || `${item.role}-${organization}-${index}`;
        const showLinkDialog = activeLinkItemId === itemKey && organizationLinks.length > 1;
        const isEditing = editingItemId === item.id && renderEditingItem;

        if (isEditing) {
          return (
            <div
              key={itemKey}
              data-experience-editing-id={item.id}
              className="border-b border-white/[0.08] py-4 first:pt-0 last:border-b-0 last:pb-0"
            >
              {renderEditingItem(item, index)}
            </div>
          );
        }

        return (
          <article
            key={itemKey}
            className="group flex items-start gap-3 border-b border-white/[0.08] py-4 first:pt-0 last:border-b-0 last:pb-0"
          >
            <ExperienceIdentityAction
              links={organizationLinks}
              onOpenChoices={() => setActiveLinkItemId(itemKey)}
              ariaLabel={`Open links for ${organization}`}
            >
              <ExperienceIdentityMark
                name={organization}
                logoUrl={cleanExperienceText(item.organization_logo_url) || inferredLogoUrl}
              />
            </ExperienceIdentityAction>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white/86">
                    <span>{cleanExperienceText(item.role) || "Creator role"}</span>
                    <span className="px-1.5 text-subtle">| </span>
                    <ExperienceIdentityAction links={organizationLinks} onOpenChoices={() => setActiveLinkItemId(itemKey)}>
                      <span className="text-white/68 hover:text-white">{organization}</span>
                    </ExperienceIdentityAction>
                  </p>
                  {cleanExperienceText(item.work_type) ? (
                    <p className="mt-1 text-xs text-muted">{cleanExperienceText(item.work_type)}</p>
                  ) : null}
                  {secondaryMeta ? <p className="mt-1 text-xs text-subtle">{secondaryMeta}</p> : null}
                </div>
                {actions ? (
                  <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    {actions(item)}
                  </div>
                ) : null}
              </div>

              {tools.length ? (
                <p className="mt-2 text-xs text-subtle">{tools.join(" · ")}</p>
              ) : null}
              {cleanExperienceText(item.description) ? (
                <p className="mt-2 text-sm leading-6 text-white/62">{cleanExperienceText(item.description)}</p>
              ) : null}
            </div>
            {showLinkDialog ? (
              <ExperienceLinkDialog
                organization={organization}
                links={organizationLinks}
                onClose={() => setActiveLinkItemId(null)}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
