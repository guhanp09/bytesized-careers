"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

import {
  completeLaunchFreeCheckout,
  createTalentListing,
  listMyTalentListings,
  listMyPortfolio,
  updateTalentListing,
} from "../lib/backendClient";
import type { BackendPortfolioItem, BackendTalentListing } from "../lib/backendClient";
import { Icon } from "./Icons";
import { PageLoading } from "./ui";

type Step = "basics" | "focus" | "collaboration" | "proof" | "preview" | "publish";
type AvailabilityStatus = "available" | "selective" | "unavailable";

const STEPS: Array<{ id: Step; label: string; subtitle: string }> = [
  {
    id: "basics",
    label: "Listing basics",
    subtitle: "A clear listing helps hiring teams understand what you do faster.",
  },
  {
    id: "focus",
    label: "Work focus",
    subtitle: "Show the kind of content work you want more of.",
  },
  {
    id: "collaboration",
    label: "Collaboration",
    subtitle: "Set expectations for pace, pricing, and availability.",
  },
  {
    id: "proof",
    label: "Work samples",
    subtitle: "Add work samples so teams can trust your fit before reaching out.",
  },
  {
    id: "preview",
    label: "Preview",
    subtitle: "Preview your listing before it goes live.",
  },
  {
    id: "publish",
    label: "Publish",
    subtitle: "CreatorJobs is free during beta.",
  },
];

const inputBase =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/25 focus:bg-white/[0.07]";
const textareaBase =
  "min-h-[118px] w-full rounded-xl border border-white/10 bg-white/[0.055] px-3 py-2.5 text-sm leading-6 text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/25 focus:bg-white/[0.07]";
const selectBase =
  "h-11 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none transition-colors focus:border-white/25 focus:bg-white/[0.07]";

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const parseMoney = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const formatInr = (amount: string) => {
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? `₹${new Intl.NumberFormat("en-IN").format(parsed)}` : amount;
};

const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={["space-y-1.5", wide ? "sm:col-span-2" : ""].join(" ")}>
      <span className="text-xs font-medium text-white/55">{label}</span>
      {children}
    </label>
  );
}

function StepShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-5 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)] sm:p-6">
      {children}
    </section>
  );
}

function TalentPreview({
  title,
  primaryRole,
  location,
  timezone,
  workMode,
  niche,
  platforms,
  tools,
  rateNote,
  rateMin,
  rateMax,
  rateCurrency,
}: {
  title: string;
  primaryRole: string;
  location: string;
  timezone: string;
  workMode: string;
  niche: string;
  platforms: string[];
  tools: string[];
  rateNote: string;
  rateMin: string;
  rateMax: string;
  rateCurrency: string;
}) {
  const role = primaryRole.trim() || "Content talent";
  const showTitle = title.trim() || "Your talent listing headline";
  const meta = [role, location.trim() || "Remote", timezone.trim()].filter(Boolean).join(" · ");
  const context = [niche.trim(), platforms.slice(0, 2).join(" · "), tools.slice(0, 2).join(" · ")]
    .filter(Boolean)
    .join(" · ");
  const min = rateMin.trim();
  const max = rateMax.trim();
  const currency = rateCurrency.trim().toUpperCase() || "INR";
  const rate =
    rateNote.trim() ||
    (min && max
      ? currency === "INR"
        ? `${formatInr(min)}-${formatInr(max)}`
        : `${currency} ${min}-${max}`
      : min
        ? currency === "INR"
          ? `${formatInr(min)}+`
          : `${currency} ${min}+`
        : "Rate flexible");

  return (
    <article className="flex min-h-[260px] flex-col rounded-[26px] border border-white/[0.08] bg-white/[0.045] p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.07] text-xs font-bold text-white/72">
          {initials(role) || <Icon name="user" className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white/86">{role}</p>
          <p className="mt-1 truncate text-xs text-white/45">{meta}</p>
        </div>
      </div>

      <h3 className="mt-5 line-clamp-2 text-lg font-semibold leading-tight tracking-tight text-white">{showTitle}</h3>
      {context ? <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/58">{context}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/45">
        <span>{titleCase(workMode || "Remote")}</span>
        <span className="text-white/25">•</span>
        <span>{rate}</span>
      </div>
      <div className="mt-auto pt-5 text-sm font-semibold text-white/78">Preview listing</div>
    </article>
  );
}

const titleCase = (value?: string | null) =>
  value
    ? value
        .split(/[_-\s]+/)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ")
    : "";

export default function PostTalentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const draftId = searchParams.get("draftId") || "";
  const [step, setStep] = useState<Step>("basics");
  const [title, setTitle] = useState("");
  const [primaryRole, setPrimaryRole] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [roles, setRoles] = useState("");
  const [niche, setNiche] = useState("");
  const [formats, setFormats] = useState("");
  const [platforms, setPlatforms] = useState("");
  const [tools, setTools] = useState("");
  const [location, setLocation] = useState("");
  const [timezone, setTimezone] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState<AvailabilityStatus>("available");
  const [workMode, setWorkMode] = useState("Remote");
  const [turnaround, setTurnaround] = useState("");
  const [rateMin, setRateMin] = useState("");
  const [rateMax, setRateMax] = useState("");
  const [rateCurrency, setRateCurrency] = useState("INR");
  const [rateNote, setRateNote] = useState("");
  const [description, setDescription] = useState("");
  const [portfolioItems, setPortfolioItems] = useState<BackendPortfolioItem[]>([]);
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<string[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const activeStep = STEPS[stepIndex] || STEPS[0];
  const progress = (stepIndex + 1) / STEPS.length;
  const canGoBack = stepIndex > 0;
  const canGoNext = stepIndex < STEPS.length - 1;
  const rolesList = parseList(roles);
  const formatsList = parseList(formats);
  const platformsList = parseList(platforms);
  const toolsList = parseList(tools);
  const workSampleItems = portfolioItems.filter((item) => item.is_public && item.publish_status !== "draft");

  const rateError = useMemo(() => {
    const min = parseMoney(rateMin);
    const max = parseMoney(rateMax);
    if (Number.isNaN(min) || Number.isNaN(max)) return "Rates must be valid numbers.";
    if ((min ?? 0) < 0 || (max ?? 0) < 0) return "Rates cannot be negative.";
    if (min !== null && max !== null && max < min) return "Rate max cannot be lower than rate min.";
    return null;
  }, [rateMin, rateMax]);

  useEffect(() => {
    if (status === "unauthenticated") {
      const next = draftId ? `/post-talent?draftId=${encodeURIComponent(draftId)}` : "/post-talent";
      router.push(`/auth?mode=login&next=${encodeURIComponent(next)}`);
    }
  }, [draftId, router, status]);

  useEffect(() => {
    const token = session?.backendAccessToken;
    if (!token || !draftId) return;
    let mounted = true;
    const hydrate = (listing: BackendTalentListing) => {
      setTitle(listing.title || "");
      setPrimaryRole(listing.primary_role || "");
      setExperienceLevel(listing.experience_level || "");
      setRoles(listing.roles.join(", "));
      setNiche(listing.niche || "");
      setFormats(listing.formats.join(", "));
      setPlatforms(listing.platforms.join(", "));
      setTools(listing.tools.join(", "));
      setLocation(listing.location || "");
      setTimezone(listing.timezone || "");
      setAvailabilityStatus(listing.availability_status);
      setWorkMode(listing.work_mode || "Remote");
      setTurnaround(listing.turnaround || "");
      setRateMin(listing.rate_min != null ? String(listing.rate_min) : "");
      setRateMax(listing.rate_max != null ? String(listing.rate_max) : "");
      setRateCurrency(listing.rate_currency || "INR");
      setRateNote(listing.rate_note || "");
      setDescription(listing.description || "");
      setSelectedPortfolioIds(listing.portfolio_item_ids || []);
    };
    setDraftLoading(true);
    void listMyTalentListings(token)
      .then((listings) => {
        if (!mounted) return;
        const listing = listings.find((item) => item.id === draftId);
        if (listing) {
          hydrate(listing);
        } else {
          setError("This talent listing draft could not be found.");
        }
      })
      .catch(() => {
        if (mounted) setError("Couldn’t load this talent listing draft.");
      })
      .finally(() => {
        if (mounted) setDraftLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [draftId, session?.backendAccessToken]);

  useEffect(() => {
    const token = session?.backendAccessToken;
    if (!token) return;
    let mounted = true;
    setPortfolioLoading(true);
    void listMyPortfolio(token)
      .then((response) => {
        if (!mounted) return;
        setPortfolioItems(response.items);
      })
      .catch(() => {
        if (!mounted) return;
        setPortfolioItems([]);
      })
      .finally(() => {
        if (!mounted) return;
        setPortfolioLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [session?.backendAccessToken]);

  const validateBasics = () => {
    if (title.trim().length < 3) {
      setError("Add a clear listing headline.");
      return false;
    }
    setError(null);
    return true;
  };

  const validateCollaboration = () => {
    if (rateError) {
      setError(rateError);
      return false;
    }
    setError(null);
    return true;
  };

  const validateCurrentStep = () => {
    if (step === "basics") return validateBasics();
    if (step === "collaboration") return validateCollaboration();
    setError(null);
    return true;
  };

  const goNext = () => {
    if (!canGoNext || !validateCurrentStep()) return;
    setStep(STEPS[stepIndex + 1].id);
  };

  const goBack = () => {
    if (!canGoBack) return;
    setError(null);
    setStep(STEPS[stepIndex - 1].id);
  };

  const togglePortfolio = (id: string) => {
    setSelectedPortfolioIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const payload = (publishStatus: "draft" | "published") => ({
    title: title.trim(),
    primary_role: primaryRole.trim() || rolesList[0] || null,
    experience_level: experienceLevel.trim() || null,
    roles: rolesList,
    niche: niche.trim() || null,
    formats: formatsList,
    platforms: platformsList,
    tools: toolsList,
    work_mode: workMode.trim() || null,
    location: location.trim() || null,
    timezone: timezone.trim() || null,
    availability_status: availabilityStatus,
    rate_min: rateMin.trim() ? Number(rateMin) : null,
    rate_max: rateMax.trim() ? Number(rateMax) : null,
    rate_currency: rateCurrency.trim().toUpperCase() || "INR",
    rate_note: rateNote.trim() || null,
    open_slots: null,
    turnaround: turnaround.trim() || null,
    description: description.trim() || null,
    portfolio_item_ids: selectedPortfolioIds,
    status: publishStatus,
  });

  const submit = async (publishStatus: "draft" | "published") => {
    const token = session?.backendAccessToken;
    if (!token) {
      const next = draftId ? `/post-talent?draftId=${encodeURIComponent(draftId)}` : "/post-talent";
      router.push(`/auth?mode=login&next=${encodeURIComponent(next)}`);
      return;
    }
    if (!validateBasics() || !validateCollaboration()) return;
    setBusy(true);
    setError(null);
    try {
      if (publishStatus === "published") {
        await completeLaunchFreeCheckout(token, {
          kind: "talent_listing",
          target_type: "talent_listing",
          checkout_intent_id: `launch_talent_listing_${Date.now()}`,
        });
      }
      if (draftId) {
        await updateTalentListing(token, draftId, payload(publishStatus));
      } else {
        await createTalentListing(token, payload(publishStatus));
      }
      router.push(publishStatus === "draft" ? "/activity?tab=drafts" : "/talent");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save this talent listing. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading" || draftLoading) {
    return <PageLoading blocks={4} />;
  }

  const renderStep = () => {
    if (step === "basics") {
      return (
        <StepShell>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Listing headline" wide>
              <input className={inputBase} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Retention-focused video editor for creator-led channels" />
            </Field>
            <Field label="Primary role">
              <input className={inputBase} value={primaryRole} onChange={(event) => setPrimaryRole(event.target.value)} placeholder="Video editor" />
            </Field>
            <Field label="Experience level">
              <input className={inputBase} value={experienceLevel} onChange={(event) => setExperienceLevel(event.target.value)} placeholder="Mid-level, senior" />
            </Field>
            <Field label="Location">
              <input className={inputBase} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Remote, Chennai" />
            </Field>
            <Field label="Timezone">
              <input className={inputBase} value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="IST" />
            </Field>
            <Field label="Availability" wide>
              <select
                className={selectBase}
                value={availabilityStatus}
                onChange={(event) => setAvailabilityStatus(event.target.value as AvailabilityStatus)}
              >
                <option value="available">Open to new work</option>
                <option value="selective">Limited capacity</option>
                <option value="unavailable">Booked</option>
              </select>
            </Field>
          </div>
        </StepShell>
      );
    }

    if (step === "focus") {
      return (
        <StepShell>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Roles" wide>
              <input className={inputBase} value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="Video editor, thumbnail designer" />
            </Field>
            <Field label="Niches / categories">
              <input className={inputBase} value={niche} onChange={(event) => setNiche(event.target.value)} placeholder="Gaming, education, business" />
            </Field>
            <Field label="Content formats">
              <input className={inputBase} value={formats} onChange={(event) => setFormats(event.target.value)} placeholder="Shorts, long-form, reels" />
            </Field>
            <Field label="Platforms">
              <input className={inputBase} value={platforms} onChange={(event) => setPlatforms(event.target.value)} placeholder="YouTube, Instagram, TikTok" />
            </Field>
            <Field label="Tools">
              <input className={inputBase} value={tools} onChange={(event) => setTools(event.target.value)} placeholder="Premiere Pro, DaVinci Resolve, Figma" />
            </Field>
            <Field label="Services offered" wide>
              <textarea className={textareaBase} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A listing-specific note about the kind of work you want to be hired for." />
            </Field>
          </div>
        </StepShell>
      );
    }

    if (step === "collaboration") {
      return (
        <StepShell>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work mode">
              <select className={selectBase} value={workMode} onChange={(event) => setWorkMode(event.target.value)}>
                <option value="Remote">Remote</option>
                <option value="Hybrid">Hybrid</option>
                <option value="On-site">On-site</option>
              </select>
            </Field>
            <Field label="Turnaround">
              <input className={inputBase} value={turnaround} onChange={(event) => setTurnaround(event.target.value)} placeholder="24-48 hours, weekly, ongoing" />
            </Field>
            <Field label="Rate guidance" wide>
              <input className={inputBase} value={rateNote} onChange={(event) => setRateNote(event.target.value)} placeholder="Contact for pricing, project-based, monthly retainer" />
            </Field>
            <Field label="Rate min">
              <input type="number" min="0" className={inputBase} value={rateMin} onChange={(event) => setRateMin(event.target.value)} placeholder="5000" />
            </Field>
            <Field label="Rate max">
              <input type="number" min="0" className={inputBase} value={rateMax} onChange={(event) => setRateMax(event.target.value)} placeholder="25000" />
            </Field>
            <Field label="Currency">
              <input className={`${inputBase} uppercase`} value={rateCurrency} onChange={(event) => setRateCurrency(event.target.value)} placeholder="INR" />
            </Field>
          </div>
        </StepShell>
      );
    }

    if (step === "proof") {
      return (
        <StepShell>
          {portfolioLoading ? (
            <p className="text-sm text-white/55">Loading portfolio projects...</p>
          ) : workSampleItems.length ? (
            <div className="grid gap-3">
              {workSampleItems.slice(0, 6).map((item) => {
                const selected = selectedPortfolioIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => togglePortfolio(item.id)}
                    className={[
                      "cursor-pointer rounded-2xl border p-4 text-left transition-colors",
                      selected ? "border-white/30 bg-white/[0.10]" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]",
                    ].join(" ")}
                  >
                    <p className="line-clamp-1 text-sm font-semibold text-white/88">{item.title}</p>
                    <p className="mt-1 line-clamp-1 text-xs text-white/48">
                      {[item.role_name || item.role || item.user_role_in_project, item.source_type, item.tools?.slice(0, 2).join(" · ")]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-sm font-semibold text-white/86">No public portfolio projects yet.</p>
              <p className="mt-2 text-sm leading-6 text-white/55">
                You can publish now and add work samples later, or add projects before creating this listing.
              </p>
              <Link
                href="/you?tab=portfolio"
                className="mt-4 inline-flex cursor-pointer rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white/74 transition hover:bg-white/[0.06] hover:text-white"
              >
                Open portfolio →
              </Link>
            </div>
          )}
        </StepShell>
      );
    }

    if (step === "preview") {
      return (
        <StepShell>
          <TalentPreview
            title={title}
            primaryRole={primaryRole || rolesList[0] || ""}
            location={location}
            timezone={timezone}
            workMode={workMode}
            niche={niche}
            platforms={platformsList}
            tools={toolsList}
            rateNote={rateNote}
            rateMin={rateMin}
            rateMax={rateMax}
            rateCurrency={rateCurrency}
          />
        </StepShell>
      );
    }

    return (
      <StepShell>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/38">Launch-free checkout</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Standard talent listing</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/56">
              Free during beta. No payment is required right now, and your listing can still be edited or closed later from Activity.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 px-4 py-3 text-right">
            <p className="text-xs text-white/42">Due today</p>
            <p className="text-2xl font-semibold text-white">₹0</p>
          </div>
        </div>
        <div className="mt-7 divide-y divide-white/10 rounded-2xl border border-white/10">
          <CheckoutRow label="Standard price" value="₹499" />
          <CheckoutRow label="Launch beta adjustment" value="-₹499" />
          <CheckoutRow label="Total due now" value="₹0" strong />
        </div>
        <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-sm leading-6 text-white/55">
          Your listing will publish after confirmation. You can manage it later from Activity or your workspace.
        </div>
      </StepShell>
    );
  };

  return (
    <main className="min-h-screen bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto grid max-w-6xl items-start gap-6 lg:grid-cols-[1fr_390px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-white/[0.08] bg-white/[0.06] p-6 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)] sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Free during beta</p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {draftId ? "Edit talent listing" : "Create talent listing"}
            </h1>
            <p className="mt-4 text-sm leading-6 text-white/55">
              Publish what you do so hiring teams can discover you.
            </p>
            {draftId ? (
              <p className="mt-2 text-xs text-white/42">You are editing a saved talent listing draft.</p>
            ) : null}
            <div className="mt-4">
              <div className="h-[3px] overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white/45 transition-[width] duration-300 ease-out"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/38">
                {STEPS.map((item, index) => (
                  <span key={item.id} className={index === stepIndex ? "text-white/80" : ""}>
                    {index + 1}. {item.label}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/[0.08] bg-white/[0.045] p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
              Step {stepIndex + 1} of {STEPS.length}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">{activeStep.label}</h2>
            <p className="mt-2 text-sm leading-6 text-white/55">{activeStep.subtitle}</p>
          </section>

          {error ? (
            <section className="rounded-2xl border border-amber-200/20 bg-amber-200/10 px-4 py-3 text-sm text-amber-50">
              {error}
            </section>
          ) : null}

          {renderStep()}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={!canGoBack || busy}
                className="h-11 cursor-pointer rounded-xl border border-white/[0.1] px-5 text-sm font-semibold text-white/76 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Back
              </button>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void submit("draft")}
                disabled={busy}
                className="h-11 cursor-pointer rounded-xl border border-white/[0.1] px-5 text-sm font-semibold text-white/76 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Saving..." : "Save draft"}
              </button>
              {canGoNext ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={busy}
                  className="h-11 cursor-pointer rounded-xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void submit("published")}
                  disabled={busy}
                  className="h-11 cursor-pointer rounded-xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Publishing..." : "Publish talent listing"}
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20">
          <TalentPreview
            title={title}
            primaryRole={primaryRole || rolesList[0] || ""}
            location={location}
            timezone={timezone}
            workMode={workMode}
            niche={niche}
            platforms={platformsList}
            tools={toolsList}
            rateNote={rateNote}
            rateMin={rateMin}
            rateMax={rateMax}
            rateCurrency={rateCurrency}
          />
          <section className="rounded-3xl border border-white/[0.08] bg-white/[0.045] p-5">
            <p className="text-sm font-semibold text-white/86">Publishing checklist</p>
            <div className="mt-4 space-y-3 text-sm text-white/55">
              <p>Clear headline</p>
              <p>Specific roles, platforms, and tools</p>
              <p>Relevant work samples from your portfolio</p>
              <p>Free beta confirmation before publishing</p>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function CheckoutRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <span className="text-white/52">{label}</span>
      <span className={strong ? "font-semibold text-white" : "text-white/74"}>{value}</span>
    </div>
  );
}
