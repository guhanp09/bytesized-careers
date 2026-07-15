import { PageLoading } from "../../../components/ui";

export default function Loading() {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <PageLoading blocks={3} />
      </div>
    </main>
  );
}
