"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import type { BackendOnboardingIntent } from "../lib/backendClient";
import { getMe, updateMyOnboardingIntent } from "../lib/backendClient";

type AccountTypePageProps = {
  accessToken: string;
  nextPath: string;
};

const OPTIONS: Array<{
  value: BackendOnboardingIntent;
  label: string;
  description: string;
}> = [
  {
    value: "LOOKING_FOR_WORK",
    label: "I am looking for work",
    description: "Build a profile and find creator-led team opportunities.",
  },
  {
    value: "HIRING_CREATOR_TALENT",
    label: "I am hiring content talent",
    description: "Set up your profile to post roles and hire.",
  },
  {
    value: "BOTH",
    label: "I want to do both",
    description: "Use one profile to hire and offer services.",
  },
  {
    value: "DECIDE_LATER",
    label: "I will decide later",
    description: "Create the account now and choose next steps later.",
  },
];

const toOnboardingIntent = (
  value?: BackendOnboardingIntent | null
): BackendOnboardingIntent => {
  if (
    value === "LOOKING_FOR_WORK" ||
    value === "HIRING_CREATOR_TALENT" ||
    value === "BOTH" ||
    value === "DECIDE_LATER"
  ) {
    return value;
  }
  return "DECIDE_LATER";
};

export default function AccountTypePage({
  accessToken,
  nextPath,
}: AccountTypePageProps) {
  const router = useRouter();
  const { update } = useSession();
  const [selected, setSelected] = useState<BackendOnboardingIntent>("DECIDE_LATER");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const me = await getMe(accessToken);
        if (!mounted) return;
        if (me.account_type === "ADMIN" || me.onboarding_intent_selected_at) {
          router.replace(nextPath);
          return;
        }
        setSelected(toOnboardingIntent(me.onboarding_intent));
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Could not load onboarding intent.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [accessToken, nextPath, router]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMyOnboardingIntent(accessToken, selected);
      await update({
        user: {
          accountType: updated.account_type,
          accountTypeSelectedAt: updated.account_type_selected_at ?? null,
          onboardingIntent: updated.onboarding_intent,
          onboardingIntentSelectedAt: updated.onboarding_intent_selected_at ?? null,
        },
      });
      router.replace(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save onboarding intent.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white px-4 sm:px-6 py-10">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
        <h1 className="text-xl font-semibold text-white">Choose initial intent</h1>
        <p className="mt-2 text-sm text-white/60">
          This guides suggested next steps. You can hire and apply from the same profile later.
        </p>

        {error ? (
          <div className="mt-4 rounded-lg border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-2">
          {OPTIONS.map((option) => {
            const active = selected === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={loading || saving}
                onClick={() => setSelected(option.value)}
                className={[
                  "rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer",
                  active
                    ? "border-white bg-white text-black"
                    : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]",
                  loading || saving ? "opacity-60 pointer-events-none" : "",
                ].join(" ")}
              >
                <span className="block text-sm font-semibold">{option.label}</span>
                <span
                  className={[
                    "mt-0.5 block text-xs",
                    active ? "text-black/65" : "text-white/55",
                  ].join(" ")}
                >
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={loading || saving}
          onClick={save}
          className={[
            "mt-5 h-11 w-full rounded-xl bg-white text-black text-sm font-semibold transition-colors cursor-pointer",
            loading || saving ? "opacity-60 pointer-events-none" : "hover:bg-white/90",
          ].join(" ")}
        >
          {saving ? "Saving..." : loading ? "Loading..." : "Continue"}
        </button>
      </section>
    </main>
  );
}
