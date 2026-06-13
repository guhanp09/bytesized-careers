"use client";

import { type BackendProfileReviewItem } from "../../lib/backendClient";
import { Icon } from "../Icons";

const clampRating = (value: number) => Math.max(0, Math.min(5, value));

const formatDateShort = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const reviewerInitials = (value?: string | null) =>
  (value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

const averageFromItems = (items: BackendProfileReviewItem[]) => {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + clampRating(item.rating), 0) / items.length;
};

function ReviewStars({
  rating,
  className = "",
}: {
  rating: number;
  className?: string;
}) {
  const rounded = Math.round(clampRating(rating));
  return (
    <span className={["inline-flex items-center gap-0.5 text-sm", className].filter(Boolean).join(" ")}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={`review-star-${index}`} className={index < rounded ? "text-white/82" : "text-white/22"}>
          ★
        </span>
      ))}
    </span>
  );
}

function ReviewIdentity({
  item,
}: {
  item: BackendProfileReviewItem;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {item.reviewer_avatar_url ? (
        <img
          src={item.reviewer_avatar_url}
          alt={item.reviewer_name}
          className="h-10 w-10 shrink-0 rounded-full border border-white/12 bg-white/8 object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/8 text-xs font-semibold text-white/72">
          {reviewerInitials(item.reviewer_name) || "CJ"}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-white/90">{item.reviewer_name}</p>
          {item.verified ? <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-white/46" /> : null}
        </div>
        {item.reviewer_role ? <p className="truncate text-xs text-white/45">{item.reviewer_role}</p> : null}
      </div>
    </div>
  );
}

export function ProfileReviewsPreviewRail({
  items,
}: {
  items: BackendProfileReviewItem[];
}) {
  if (!items.length) return null;

  return (
    <div className="overflow-hidden">
      <div
        aria-label="Reviews preview"
        className="flex snap-x snap-proximity gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [mask-image:linear-gradient(to_right,transparent,black_18px,black_calc(100%-18px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.slice(0, 4).map((item) => {
          const meta = [item.relationship_label, formatDateShort(item.created_at)].filter(Boolean).join(" · ");
          return (
            <article
              key={`review-preview-${item.id}`}
              className="min-w-[360px] snap-start rounded-2xl border border-white/10 bg-white/[0.045] p-5 sm:min-w-[390px] lg:min-w-[420px]"
            >
              <ReviewIdentity item={item} />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <ReviewStars rating={item.rating} />
                {meta ? <p className="text-xs text-white/45">{meta}</p> : null}
              </div>
              <p className="mt-4 line-clamp-4 text-sm leading-6 text-white/68">{item.body}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function ProfileReviewsTabContent({
  items,
  averageRating,
  reviewCount,
  emptyMessage = "No reviews yet.",
}: {
  items: BackendProfileReviewItem[];
  averageRating?: number;
  reviewCount?: number;
  emptyMessage?: string;
}) {
  const normalizedItems = [...items].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
  const count = normalizedItems.length || Math.max(0, reviewCount || 0);
  const average = normalizedItems.length ? averageFromItems(normalizedItems) : Math.max(0, averageRating || 0);
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: normalizedItems.filter((item) => Math.round(clampRating(item.rating)) === star).length,
  }));
  const maxDistribution = Math.max(...distribution.map((item) => item.count), 0);

  if (!count && !normalizedItems.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-10 text-center">
        <p className="text-sm text-white/68">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:items-start">
          <div>
            <p className="text-3xl font-semibold tracking-tight text-white">{average ? average.toFixed(1) : "0.0"}</p>
            <p className="mt-1 text-sm text-white/58">out of 5</p>
            <ReviewStars rating={average} className="mt-3" />
            <p className="mt-3 text-sm text-white/58">
              {count} review{count === 1 ? "" : "s"}
            </p>
          </div>
          {normalizedItems.length ? (
            <div className="space-y-2">
              {distribution.map((item) => (
                <div key={`review-distribution-${item.star}`} className="grid grid-cols-[48px_minmax(0,1fr)_28px] items-center gap-3">
                  <span className="text-sm text-white/58">{item.star} star</span>
                  <div className="h-2 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full bg-white/45"
                      style={{ width: `${maxDistribution ? (item.count / maxDistribution) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-right text-sm text-white/58">{item.count}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {normalizedItems.length ? (
        <div className="space-y-4">
          {normalizedItems.map((item) => {
            const meta = [item.relationship_label, formatDateShort(item.created_at)].filter(Boolean).join(" · ");
            return (
              <article key={`review-full-${item.id}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <ReviewIdentity item={item} />
                  <ReviewStars rating={item.rating} className="sm:justify-end" />
                </div>
                {meta ? <p className="mt-4 text-xs text-white/45">{meta}</p> : null}
                <p className="mt-4 text-sm leading-7 text-white/68">{item.body}</p>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
