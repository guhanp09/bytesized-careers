export const dynamic = "force-static";

export default function HeaderPreviewPage() {
  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-[#0b0b0f] px-6 py-8 text-white">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight">Header Brand Preview</h1>
        <p className="mt-2 text-sm text-white/60">
          Use this route to quickly verify the header logo lockup and small-screen icon behavior.
        </p>
      </div>
    </main>
  );
}
