export default function SearchMatchReasons({ reasons }: { reasons?: string[] }) {
  if (!reasons?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Why this result matched">
      {reasons.slice(0, 3).map((reason) => (
        <span
          key={reason}
          className="rounded-lg border border-emerald-200/10 bg-emerald-300/[0.06] px-2 py-1 text-[10px] font-medium text-emerald-100/70"
        >
          {reason}
        </span>
      ))}
    </div>
  );
}
