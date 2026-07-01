"use client";

import Link from "next/link";
import type { ProfileRatingSummary } from "../../lib/profileRating";

type ProfileRatingLinkProps = {
  rating?: ProfileRatingSummary | null;
  ariaLabel?: string;
  className?: string;
  testId?: string;
};

export default function ProfileRatingLink({
  rating,
  ariaLabel = "View reviews",
  className = "",
  testId,
}: ProfileRatingLinkProps) {
  if (!rating || rating.count <= 0 || rating.average <= 0 || !rating.href) return null;

  return (
    <Link
      href={rating.href}
      aria-label={`${ariaLabel}, rated ${rating.average.toFixed(1)} by ${rating.count} people`}
      data-testid={testId}
      className={[
        "inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-sm font-semibold text-white/64",
        "underline-offset-4 transition-colors hover:text-white hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
        className,
      ].filter(Boolean).join(" ")}
    >
      <span aria-hidden="true" className="text-white/68">★</span>
      <span>{rating.average.toFixed(1)}</span>
      <span className="font-medium text-white/42">({rating.count})</span>
    </Link>
  );
}
