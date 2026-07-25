"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  cleanExperienceText,
  experienceUrlError,
  inferExperienceFromUrl,
  initialsForExperience,
  normalizeExperienceUrl,
} from "../../lib/profileExperience";
import { Icon } from "../Icons";
import ToolPicker from "../you/ToolPicker";

export type ProfileExperienceLinkDraft = {
  id: string;
  url: string;
  platform: string;
  resolved_name: string;
  logo_url: string;
};

export type ProfileExperienceDraft = {
  id: string;
  role: string;
  organization_name: string;
  organization_url: string;
  organization_logo_url: string;
  organization_links: ProfileExperienceLinkDraft[];
  organization_link_input: string;
  platform: string;
  work_type: string;
  work_mode: string;
  start_month: string;
  start_year: string;
  end_month: string;
  end_year: string;
  is_current: boolean;
  description: string;
  tools: string[];
  tool_input_value: string;
};

const EXPERIENCE_MONTH_OPTIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const EXPERIENCE_WORK_TYPES = ["Full-time", "Part-time", "Contract", "Freelance", "Retainer", "Internship"] as const;
const EXPERIENCE_WORK_MODES = ["Remote", "Hybrid", "On-site"] as const;

function FieldShell({
  label,
  children,
  htmlFor,
  error,
  required = false,
}: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
  error?: string | null;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
        {label}
        {required ? <span className="ml-1 text-red-300/70">*</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs leading-5 text-red-300/80">{error}</p> : null}
    </div>
  );
}

function ExperienceLogoPreview({
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
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.045] text-base font-semibold text-white/62 sm:h-24 sm:w-24 sm:rounded-[28px] sm:text-lg">
      {cleanLogoUrl && !failed ? (
        <img
          src={cleanLogoUrl}
          alt=""
          aria-hidden="true"
          onError={() => setFailedUrl(cleanLogoUrl)}
          className="h-full w-full object-cover"
        />
      ) : initials ? (
        <span>{initials}</span>
      ) : (
        <Icon name="briefcase" className="h-6 w-6" />
      )}
    </div>
  );
}

function platformIconName(platform?: string | null): "youtube" | "instagram" | "tiktok" | "linkedin" | "x" | "globe" | "external-link" {
  const normalized = platform?.toLowerCase() || "";
  if (normalized.includes("youtube")) return "youtube";
  if (normalized.includes("instagram")) return "instagram";
  if (normalized.includes("tiktok")) return "tiktok";
  if (normalized.includes("linkedin")) return "linkedin";
  if (normalized === "x" || normalized.includes("twitter")) return "x";
  if (normalized.includes("website")) return "globe";
  return "external-link";
}

function platformLabel(platform?: string | null) {
  const normalized = platform?.toLowerCase() || "";
  if (normalized.includes("youtube")) return "YouTube";
  if (normalized.includes("instagram")) return "Instagram";
  if (normalized.includes("tiktok")) return "TikTok";
  if (normalized.includes("linkedin")) return "LinkedIn";
  if (normalized === "x" || normalized.includes("twitter")) return "X";
  if (normalized.includes("website")) return "website";
  return "link";
}

function UrlSourceIconButton({ value, error }: { value: string; error?: string | null }) {
  const normalizedUrl = normalizeExperienceUrl(value);
  if (value.trim() && error) {
    return (
      <button
        type="button"
        disabled
        aria-label="Invalid URL"
        className="cursor-not-allowed rounded-md p-1 text-red-300/75"
      >
        <Icon name="alert" className="h-4 w-4" />
      </button>
    );
  }
  const inferred = inferExperienceFromUrl(value);
  const icon = <Icon name={platformIconName(inferred.platform)} className="h-4 w-4" />;

  if (!normalizedUrl) {
    return (
      <button
        type="button"
        disabled
        aria-label="URL link unavailable"
        className="cursor-default rounded-md p-1 text-subtle"
      >
        {icon}
      </button>
    );
  }

  return (
    <a
      href={normalizedUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${platformLabel(inferred.platform)} link`}
      className="cursor-pointer rounded-md p-1 text-muted transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      {icon}
    </a>
  );
}

function SaveIconButton({
  onClick,
  ariaLabel,
  disabled,
  saving,
}: {
  onClick: () => void;
  ariaLabel: string;
  disabled?: boolean;
  saving?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={[
        "inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15 disabled:cursor-not-allowed disabled:opacity-55",
        disabled ? "bg-white/20 text-muted" : "cursor-pointer bg-white text-black hover:bg-white/90",
      ].join(" ")}
    >
      <Icon name={saving ? "clock" : "check"} className="h-4 w-4" />
    </button>
  );
}

type ResolvedIdentity = {
  normalizedUrl: string | null;
  platform: string | null;
  inferredName: string | null;
  logoUrl: string | null;
  error: string | null;
};

type ValidationErrors = Partial<Record<"role" | "organization_url" | "organization_name" | "start_date" | "end_date" | "date_order", string>>;

const MIN_EXPERIENCE_YEAR = 1990;
const monthIndex = (value?: string | null) => {
  const index = EXPERIENCE_MONTH_OPTIONS.findIndex((month) => month === value);
  return index === -1 ? null : index + 1;
};

const yearValidationError = (value: string, maxYear: number) => {
  const cleanValue = value.trim();
  if (!/^\d{4}$/.test(cleanValue)) return "Enter a valid year.";
  const numericYear = Number(cleanValue);
  if (numericYear < MIN_EXPERIENCE_YEAR || numericYear > maxYear) {
    return `Year must be between ${MIN_EXPERIENCE_YEAR} and ${maxYear}.`;
  }
  return null;
};

export default function ProfileExperienceEditor({
  draft,
  onChange,
  onSubmit,
  onCancel,
  saving = false,
  isEditing = false,
  autoFocusRole = false,
  focusRequest = 0,
}: {
  draft: ProfileExperienceDraft;
  onChange: (next: ProfileExperienceDraft) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  saving?: boolean;
  isEditing?: boolean;
  autoFocusRole?: boolean;
  focusRequest?: number;
}) {
  const idPrefix = useId();
  const roleId = `${idPrefix}-role`;
  const urlId = `${idPrefix}-url`;
  const additionalUrlId = `${idPrefix}-additional-url`;
  const descriptionId = `${idPrefix}-description`;
  const organizationNameId = `${idPrefix}-organization-name`;
  const additionalInputRef = useRef<HTMLInputElement>(null);
  const roleInputRef = useRef<HTMLInputElement>(null);
  const latestDraftRef = useRef(draft);
  const primaryResolveTokenRef = useRef(0);
  const updateDraft = (patch: Partial<ProfileExperienceDraft>) => onChange({ ...latestDraftRef.current, ...patch });
  const inferredLogoUrl = inferExperienceFromUrl(draft.organization_url).suggestedLogoUrl;
  const [primaryUrlError, setPrimaryUrlError] = useState<string | null>(null);
  const [additionalUrlError, setAdditionalUrlError] = useState<string | null>(null);
  const [isResolvingPrimary, setIsResolvingPrimary] = useState(false);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const isOrganizationNameManualRef = useRef(false);
  const lastAutoOrganizationNameRef = useRef<string | null>(cleanExperienceText(draft.organization_name));

  useEffect(() => {
    latestDraftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (isAddingLink) {
      additionalInputRef.current?.focus();
    }
  }, [isAddingLink]);

  useEffect(() => {
    if (!autoFocusRole) return;
    const roleInput = roleInputRef.current;
    if (!roleInput) return;
    requestAnimationFrame(() => {
      roleInput.focus({ preventScroll: true });
      roleInput.select();
    });
  }, [autoFocusRole, focusRequest]);

  const setFieldError = (field: keyof ValidationErrors, error?: string | null) => {
    setValidationErrors((current) => {
      if (!current[field] && !error) return current;
      const next = { ...current };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  };

  const inputClassName = (hasError?: boolean) =>
    [
      "h-11 w-full rounded-xl border bg-white/[0.035] px-3 text-sm text-white [color-scheme:dark] placeholder:text-subtle hover:bg-white/[0.04] focus:bg-white/[0.035] focus:text-white focus:outline-none focus:ring-2",
      hasError
        ? "border-red-300/35 focus:border-red-300/45 focus:ring-red-300/15"
        : "border-white/10 focus:border-white/20 focus:ring-white/10",
    ].join(" ");

  const selectClassName = (hasError?: boolean) =>
    [
      "h-10 cursor-pointer rounded-xl border bg-white/[0.035] px-3 text-sm text-white [color-scheme:dark] focus:bg-white/[0.035] focus:outline-none focus:ring-2",
      hasError
        ? "border-red-300/35 focus:border-red-300/45 focus:ring-red-300/15"
        : "border-white/10 focus:border-white/20 focus:ring-white/10",
    ].join(" ");

  const shouldReplaceAutoName = () => {
    const currentName = cleanExperienceText(latestDraftRef.current.organization_name);
    if (!currentName) return true;
    if (!isOrganizationNameManualRef.current) return true;
    return Boolean(lastAutoOrganizationNameRef.current && currentName === lastAutoOrganizationNameRef.current);
  };

  const clearAutoIdentityForUrlChange = (urlValue: string) => {
    const clearName = shouldReplaceAutoName();
    updateDraft({
      organization_url: urlValue,
      organization_logo_url: "",
      platform: "",
      organization_name: clearName ? "" : latestDraftRef.current.organization_name,
    });
    if (clearName) lastAutoOrganizationNameRef.current = null;
  };

  const resolveIdentity = async (rawValue: string): Promise<ResolvedIdentity> => {
    const normalizedUrl = normalizeExperienceUrl(rawValue);
    const validationError = experienceUrlError(rawValue);
    const inferred = inferExperienceFromUrl(rawValue);

    if (!normalizedUrl || validationError) {
      return {
        normalizedUrl: normalizedUrl || rawValue.trim(),
        platform: inferred.platform,
        inferredName: inferred.suggestedOrganizationName,
        logoUrl: inferred.suggestedLogoUrl,
        error: validationError || "Enter a valid URL, like youtube.com/@channel or company.com.",
      };
    }

    try {
      const response = await fetch("/api/profile/organization-identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const data = (await response.json()) as Partial<ResolvedIdentity>;
      return {
        normalizedUrl: data.normalizedUrl || normalizedUrl,
        platform: data.platform || inferred.platform,
        inferredName: data.inferredName || inferred.suggestedOrganizationName,
        logoUrl: data.logoUrl || inferred.suggestedLogoUrl,
        error: response.ok && (data.inferredName || inferred.suggestedOrganizationName)
          ? null
          : data.error || validationError,
      };
    } catch {
      return {
        normalizedUrl,
        platform: inferred.platform,
        inferredName: inferred.suggestedOrganizationName,
        logoUrl: inferred.suggestedLogoUrl,
        error: "We could not read this page. Check the URL or enter the name manually.",
      };
    }
  };

  const applyUrlAssistance = (rawValue: string) => {
    const trimmed = rawValue.trim();
    primaryResolveTokenRef.current += 1;
    const resolveToken = primaryResolveTokenRef.current;

    if (!trimmed) {
      setPrimaryUrlError(null);
      setIsResolvingPrimary(false);
      clearAutoIdentityForUrlChange("");
      return;
    }

    const validationError = experienceUrlError(trimmed);
    if (validationError) {
      setPrimaryUrlError(validationError);
      setIsResolvingPrimary(false);
      clearAutoIdentityForUrlChange(trimmed);
      return;
    }

    setPrimaryUrlError(null);
    setFieldError("organization_url", null);
    setFieldError("organization_name", null);
    setIsResolvingPrimary(true);
    void resolveIdentity(trimmed).then((resolved) => {
      if (resolveToken !== primaryResolveTokenRef.current) return;
      setIsResolvingPrimary(false);
      setPrimaryUrlError(resolved.error);
      const currentDraft = latestDraftRef.current;
      const replaceName = shouldReplaceAutoName();
      const nextName = replaceName
        ? resolved.inferredName || ""
        : currentDraft.organization_name;
      if (replaceName) {
        lastAutoOrganizationNameRef.current = cleanExperienceText(resolved.inferredName);
        isOrganizationNameManualRef.current = false;
      }
      updateDraft({
        organization_url: resolved.normalizedUrl || trimmed,
        organization_name: nextName,
        organization_logo_url: resolved.logoUrl || "",
        platform: resolved.platform || "",
      });
    });
  };

  const completePrimaryUrl = () => {
    const rawValue = draft.organization_url.trim();
    if (!rawValue) return;
    const validationError = experienceUrlError(rawValue);
    if (validationError) {
      setPrimaryUrlError(validationError);
      return;
    }
    applyUrlAssistance(rawValue);
    setIsAddingLink(true);
  };

  const addAdditionalLink = async ({ keepOpen = false }: { keepOpen?: boolean } = {}) => {
    const rawValue = draft.organization_link_input.trim();
    if (!rawValue) return;
    const validationError = experienceUrlError(rawValue);
    if (validationError) {
      setAdditionalUrlError(validationError);
      return;
    }

    setAdditionalUrlError(null);
    const resolved = await resolveIdentity(rawValue);
    if (resolved.error) {
      setAdditionalUrlError(resolved.error);
      return;
    }
    const normalizedUrl = resolved.normalizedUrl || normalizeExperienceUrl(rawValue) || rawValue;
    const existingKeys = new Set(
      [draft.organization_url, ...draft.organization_links.map((link) => link.url)]
        .map((url) => normalizeExperienceUrl(url) || cleanExperienceText(url))
        .filter(Boolean)
    );

    if (!existingKeys.has(normalizedUrl)) {
      updateDraft({
        organization_links: [
          ...draft.organization_links,
          {
            id: `link-${Date.now().toString(36)}`,
            url: normalizedUrl,
            platform: resolved.platform || "",
            resolved_name: resolved.inferredName || "",
            logo_url: resolved.logoUrl || "",
          },
        ],
        organization_link_input: "",
      });
    } else {
      updateDraft({ organization_link_input: "" });
    }
    setIsAddingLink(keepOpen);
  };

  const validateDraft = () => {
    const nextErrors: ValidationErrors = {};
    const maxYear = new Date().getFullYear() + 1;
    const primaryUrlValidationError = draft.organization_url.trim()
      ? experienceUrlError(draft.organization_url)
      : "Enter a valid URL, like youtube.com/@channel or company.com.";

    if (!draft.role.trim()) nextErrors.role = "Enter the role or title.";
    if (primaryUrlValidationError) nextErrors.organization_url = primaryUrlValidationError;
    if (!draft.organization_name.trim()) {
      nextErrors.organization_name = "Enter the channel, page, agency, or company name.";
    }

    if (!draft.start_month || !draft.start_year.trim()) {
      nextErrors.start_date = "Enter a start month and year.";
    } else {
      const error = yearValidationError(draft.start_year, maxYear);
      if (error) nextErrors.start_date = error;
    }

    if (!draft.is_current) {
      if (!draft.end_month || !draft.end_year.trim()) {
        nextErrors.end_date = "Enter an end month and year.";
      } else {
        const error = yearValidationError(draft.end_year, maxYear);
        if (error) nextErrors.end_date = error;
      }
    }

    const startMonth = monthIndex(draft.start_month);
    const endMonth = monthIndex(draft.end_month);
    const startYear = Number(draft.start_year);
    const endYear = Number(draft.end_year);
    if (
      !nextErrors.start_date &&
      !nextErrors.end_date &&
      !draft.is_current &&
      startMonth &&
      endMonth &&
      Number.isFinite(startYear) &&
      Number.isFinite(endYear)
    ) {
      const startScore = startYear * 12 + startMonth;
      const endScore = endYear * 12 + endMonth;
      if (startScore > endScore) {
        nextErrors.date_order = "End date must be after the start date.";
      }
    }

    return nextErrors;
  };

  const handleSaveAttempt = () => {
    const nextErrors = validateDraft();
    setValidationErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit();
  };

  return (
    <article className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="space-y-4">
        <div className="grid gap-5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-start">
          <div className="flex w-full shrink-0 flex-col items-center gap-2 sm:w-30">
            <ExperienceLogoPreview
              name={draft.organization_name || draft.role || "Creator team"}
              logoUrl={draft.organization_logo_url || inferredLogoUrl}
            />
            <textarea
              id={organizationNameId}
              aria-label="Channel, page, agency, or company name"
              value={draft.organization_name}
              onChange={(event) => {
                isOrganizationNameManualRef.current = true;
                setFieldError("organization_name", null);
                updateDraft({ organization_name: event.target.value });
              }}
              rows={2}
              className={[
                "w-full max-w-[9rem] resize-none rounded-lg border bg-transparent px-1 py-1 text-center text-sm font-semibold leading-5 text-white/76 placeholder:text-subtle hover:bg-white/[0.025] focus:bg-white/[0.035] focus:outline-none focus:ring-2",
                validationErrors.organization_name
                  ? "border-red-300/35 focus:border-red-300/45 focus:ring-red-300/15"
                  : "border-transparent hover:border-white/10 focus:border-white/15 focus:ring-white/10",
              ].join(" ")}
              placeholder={isResolvingPrimary ? "Resolving..." : ""}
              title="Edit channel, page, agency, or company name"
            />
            {validationErrors.organization_name ? (
              <p className="max-w-[9rem] text-center text-xs leading-5 text-red-300/80">{validationErrors.organization_name}</p>
            ) : null}
          </div>

          <div className="min-w-0 space-y-4">
            <FieldShell label="Role/title" htmlFor={roleId} required error={validationErrors.role}>
              <input
                ref={roleInputRef}
                id={roleId}
                aria-label="Role/title"
                value={draft.role}
                aria-invalid={Boolean(validationErrors.role)}
                onChange={(event) => {
                  setFieldError("role", null);
                  updateDraft({ role: event.target.value });
                }}
                className={inputClassName(Boolean(validationErrors.role))}
                placeholder="Video editor, thumbnail designer, scriptwriter..."
              />
            </FieldShell>

            <FieldShell
              label="Channel/page/company URL"
              htmlFor={urlId}
              required
              error={validationErrors.organization_url || primaryUrlError}
            >
              <div className="space-y-2">
                <div className="relative">
                  <input
                    id={urlId}
                    aria-label="Channel/page/company URL"
                    value={draft.organization_url}
                    aria-invalid={Boolean(validationErrors.organization_url || primaryUrlError)}
                    onChange={(event) => {
                      setPrimaryUrlError(null);
                      setFieldError("organization_url", null);
                      setFieldError("organization_name", null);
                      clearAutoIdentityForUrlChange(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        completePrimaryUrl();
                      }
                    }}
                    onBlur={(event) => applyUrlAssistance(event.target.value)}
                    onPaste={(event) => {
                      const pasted = event.clipboardData.getData("text");
                      if (!pasted) return;
                      window.setTimeout(() => applyUrlAssistance(pasted), 0);
                    }}
                    className={`${inputClassName(Boolean(validationErrors.organization_url || primaryUrlError))} pr-12`}
                    placeholder="youtube.com/@channel, instagram.com/page, company.com..."
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                    <UrlSourceIconButton
                      value={draft.organization_url}
                      error={validationErrors.organization_url || primaryUrlError}
                    />
                  </span>
                </div>
                {draft.organization_links.length ? (
                  <div className="space-y-2">
                    {draft.organization_links.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-white/62">
                          {link.url}
                        </span>
                        <UrlSourceIconButton value={link.url} />
                        <button
                          type="button"
                          aria-label={`Remove ${link.platform || "link"}`}
                          onClick={() =>
                            updateDraft({
                              organization_links: draft.organization_links.filter((item) => item.id !== link.id),
                            })
                          }
                          className="cursor-pointer text-subtle transition-colors hover:text-white"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {isAddingLink ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-0 flex-1">
                      <input
                        ref={additionalInputRef}
                        id={additionalUrlId}
                        aria-label="Additional link"
                        value={draft.organization_link_input}
                        aria-invalid={Boolean(additionalUrlError)}
                        onChange={(event) => {
                          setAdditionalUrlError(null);
                          updateDraft({ organization_link_input: event.target.value });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void addAdditionalLink({ keepOpen: true });
                          }
                        }}
                        onBlur={() => {
                          if (draft.organization_link_input.trim()) void addAdditionalLink();
                        }}
                        className={`${inputClassName(Boolean(additionalUrlError))} h-10 pr-12`}
                        placeholder="Add another YouTube, Instagram, TikTok, LinkedIn, X, or website link..."
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2">
                        <UrlSourceIconButton value={draft.organization_link_input} error={additionalUrlError} />
                      </span>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsAddingLink(true)}
                    className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted transition-colors hover:text-white"
                  >
                    <Icon name="plus" className="h-3.5 w-3.5" />
                    Add another link
                  </button>
                )}
                {additionalUrlError ? <p className="text-xs leading-5 text-red-300/80">{additionalUrlError}</p> : null}
              </div>
            </FieldShell>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <FieldShell label="Start" required error={validationErrors.start_date}>
              <div className="grid grid-cols-[minmax(96px,120px)_minmax(84px,104px)] gap-2">
                <select
                  aria-label="Start month"
                  value={draft.start_month}
                  aria-invalid={Boolean(validationErrors.start_date)}
                  onChange={(event) => {
                    setFieldError("start_date", null);
                    setFieldError("date_order", null);
                    updateDraft({ start_month: event.target.value });
                  }}
                  className={selectClassName(Boolean(validationErrors.start_date))}
                >
                  <option value="">Month</option>
                  {EXPERIENCE_MONTH_OPTIONS.map((month) => (
                    <option key={`start-month-${month}`} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Start year"
                  value={draft.start_year}
                  aria-invalid={Boolean(validationErrors.start_date)}
                  onChange={(event) => {
                    setFieldError("start_date", null);
                    setFieldError("date_order", null);
                    updateDraft({ start_year: event.target.value });
                  }}
                  className={`${inputClassName(Boolean(validationErrors.start_date))} h-10`}
                  placeholder="Year"
                />
              </div>
            </FieldShell>
            <span className="hidden pb-3 text-sm text-subtle lg:block">→</span>
            <FieldShell label="End" required={!draft.is_current} error={validationErrors.end_date}>
              {draft.is_current ? (
                <div className="flex h-10 min-w-[122px] items-center rounded-xl border border-white/10 bg-white/[0.02] px-3 text-sm text-muted">
                  Present
                </div>
              ) : (
                <div className="grid grid-cols-[minmax(96px,120px)_minmax(84px,104px)] gap-2">
                  <select
                    aria-label="End month"
                    value={draft.end_month}
                    aria-invalid={Boolean(validationErrors.end_date)}
                    onChange={(event) => {
                      setFieldError("end_date", null);
                      setFieldError("date_order", null);
                      updateDraft({ end_month: event.target.value });
                    }}
                    className={selectClassName(Boolean(validationErrors.end_date))}
                  >
                    <option value="">Month</option>
                    {EXPERIENCE_MONTH_OPTIONS.map((month) => (
                      <option key={`end-month-${month}`} value={month}>
                        {month}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="End year"
                    value={draft.end_year}
                    aria-invalid={Boolean(validationErrors.end_date)}
                    onChange={(event) => {
                      setFieldError("end_date", null);
                      setFieldError("date_order", null);
                      updateDraft({ end_year: event.target.value });
                    }}
                    className={`${inputClassName(Boolean(validationErrors.end_date))} h-10`}
                    placeholder="Year"
                  />
                </div>
              )}
            </FieldShell>
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 pb-2 text-xs font-medium text-muted">
              <input
                type="checkbox"
                checked={draft.is_current}
                onChange={(event) => {
                  setFieldError("end_date", null);
                  setFieldError("date_order", null);
                  updateDraft({
                    is_current: event.target.checked,
                    end_month: event.target.checked ? "" : draft.end_month,
                    end_year: event.target.checked ? "" : draft.end_year,
                  });
                }}
                className="h-4 w-4 cursor-pointer accent-white"
              />
              Currently working here
            </label>
          </div>
          {validationErrors.date_order ? (
            <p className="-mt-2 text-xs leading-5 text-red-300/80">{validationErrors.date_order}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <FieldShell label="Work mode">
              <select
                aria-label="Work mode"
                value={draft.work_mode || "Remote"}
                onChange={(event) => updateDraft({ work_mode: event.target.value })}
                className={`${selectClassName()} min-w-[132px]`}
              >
                {EXPERIENCE_WORK_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </FieldShell>
            <FieldShell label="Work type">
              <select
                aria-label="Work type"
                value={draft.work_type || "Freelance"}
                onChange={(event) => updateDraft({ work_type: event.target.value })}
                className={`${selectClassName()} min-w-[132px]`}
              >
                {EXPERIENCE_WORK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </FieldShell>
          </div>

          <FieldShell label="Description" htmlFor={descriptionId}>
            <div className="relative">
              <textarea
                id={descriptionId}
                aria-label="Experience description"
                value={draft.description}
                maxLength={500}
                onChange={(event) => updateDraft({ description: event.target.value.slice(0, 500) })}
                rows={3}
                className="min-h-[96px] w-full resize-y rounded-[20px] border border-white/10 bg-white/[0.035] px-3 pb-7 pt-2.5 text-sm leading-6 text-white placeholder:text-subtle focus:border-white/20 focus:bg-white/[0.035] focus:outline-none focus:ring-2 focus:ring-white/10"
                placeholder="Describe your contribution. What did you create, improve, manage, or deliver for this channel/page?"
              />
              <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-subtle">
                {draft.description.length}/500
              </span>
            </div>
          </FieldShell>

          <div className="-mt-1">
            <ToolPicker value={draft.tools} onChange={(tools) => updateDraft({ tools })} />
          </div>

          <div className="flex items-center justify-end gap-2">
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="h-10 cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-white/58 transition-colors hover:bg-white/[0.07] hover:text-white"
              >
                Cancel
              </button>
            ) : null}
            <SaveIconButton
              onClick={handleSaveAttempt}
              disabled={saving}
              saving={saving}
              ariaLabel={isEditing ? "Save experience" : "Add experience"}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
