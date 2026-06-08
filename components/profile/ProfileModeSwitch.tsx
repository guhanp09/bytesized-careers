"use client";

import { useRouter } from "next/navigation";

type ProfileModeSwitchProps = {
  username: string;
  activeMode: "talent" | "hiring";
};

export default function ProfileModeSwitch({ username, activeMode }: ProfileModeSwitchProps) {
  const router = useRouter();

  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.035] p-1">
      {(["talent", "hiring"] as const).map((mode) => {
        const active = activeMode === mode;
        return (
          <button
            key={`profile-mode-${mode}`}
            type="button"
            aria-pressed={active}
            onClick={() => router.push(`/u/${encodeURIComponent(username)}?view=${mode}`)}
            className={[
              "inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
              active
                ? "bg-white text-black"
                : "text-white/55 hover:bg-white/[0.06] hover:text-white/82",
            ].join(" ")}
          >
            {mode === "talent" ? "Talent" : "Recruiter"}
          </button>
        );
      })}
    </div>
  );
}
