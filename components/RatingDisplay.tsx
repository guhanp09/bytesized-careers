type RatingDisplayProps = {
  averageRating?: number | null;
  reviewCount?: number | null;
  isRealRating?: boolean;
  className?: string;
};

const filledStars = (rating: number) => {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return `${"★".repeat(filled)}${"☆".repeat(5 - filled)}`;
};

export default function RatingDisplay({
  averageRating = 0,
  reviewCount = 0,
  isRealRating = false,
  className = "",
}: RatingDisplayProps) {
  const count = Math.max(0, reviewCount || 0);
  const hasRealRating = isRealRating && count > 0 && Boolean(averageRating);

  const label = hasRealRating
    ? `${filledStars(averageRating || 0)} ${averageRating?.toFixed(1)} · ${count} reviews`
    : "No reviews yet";

  return (
    <span
      className={[
        "inline-flex items-center text-xs font-medium tracking-[0.04em] text-muted",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={hasRealRating ? `${averageRating} rating from ${count} reviews` : "No reviews yet"}
    >
      {label}
    </span>
  );
}
