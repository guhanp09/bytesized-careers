"use client";

export default function PageLoading({
  blocks = 3,
}: {
  blocks?: number;
}) {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-6xl space-y-6">
        <div className="space-y-3 border-b border-white/[0.08] pb-5">
          <div className="ui-skeleton h-8 w-40 rounded-xl" />
          <div className="ui-skeleton h-4 w-full max-w-xl rounded-xl" />
        </div>
        <div className="grid gap-4">
          {Array.from({ length: blocks }).map((_, index) => (
            <div
              key={`page-loading-${index}`}
              className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-6"
            >
              <div className="space-y-3">
                <div className="ui-skeleton h-4 w-32 rounded-full" />
                <div className="ui-skeleton h-6 w-3/4 rounded-xl" />
                <div className="ui-skeleton h-4 w-full rounded-xl" />
                <div className="ui-skeleton h-4 w-5/6 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
