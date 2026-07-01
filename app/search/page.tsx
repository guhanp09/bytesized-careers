import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";

export default async function SearchRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = first(params.q).trim();
  const target = first(params.type) === "talent" ? "/talent" : "/jobs";

  redirect(q ? `${target}?q=${encodeURIComponent(q)}` : target);
}
