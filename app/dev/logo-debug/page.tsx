import fs from "node:fs";
import crypto from "node:crypto";
import Image from "next/image";
import { notFound } from "next/navigation";
import BrandLogo from "../../../components/BrandLogo";

const rawUrl = "/brand/logo-reference-raw.png";
const extractedUrl = "/brand/logo-mark.png";
const expectedSha = "1babb3afae8dd4a824a424bacd38b413607ea4d0aa820a120c863a9bb50e049e";

function sha256(path: string): string {
  const buffer = fs.readFileSync(path);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export default function LogoDebugPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const rawSha = sha256("public/brand/logo-reference-raw.png");
  const shaMatches = rawSha === expectedSha;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-[#0b0d10] px-6 py-8 text-white">
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Logo Debug</h1>
          <p className="mt-2 text-sm text-white/60">Raw reference, extracted transparent mark, and header-rendered mark comparison.</p>
          <p className="mt-2 text-xs font-mono text-white/70">SHA256: {rawSha}</p>
          <p className={`mt-1 text-xs ${shaMatches ? "text-emerald-300" : "text-rose-300"}`}>
            SHA match expected: {shaMatches ? "yes" : "no"}
          </p>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-[#0f1014] p-4">
              <p className="text-xs text-white/60">1) Raw reference</p>
              <div className="mt-3 inline-flex rounded-md bg-[#0f1014]">
                <Image
                  src={rawUrl}
                  alt="Raw logo reference"
                  width={1536}
                  height={1024}
                  className="block h-32 w-auto select-none"
                  draggable={false}
                />
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#0f1014] p-4">
              <p className="text-xs text-white/60">2) Extracted transparent mark</p>
              <div className="mt-3 inline-flex rounded-md bg-[#0f1014]">
                <Image
                  src={extractedUrl}
                  alt="Extracted transparent logo mark"
                  width={496}
                  height={336}
                  className="block h-32 w-auto select-none"
                  draggable={false}
                />
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#0f1014] p-4">
              <p className="text-xs text-white/60">3) Header render @32</p>
              <div className="mt-3 inline-flex items-center gap-3 leading-none">
                <BrandLogo height={32} />
                <span className="text-2xl font-semibold tracking-tight leading-none">CreatorJobs</span>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#0f1014] p-4">
              <p className="text-xs text-white/60">4) Header render @40</p>
              <div className="mt-3 inline-flex items-center gap-3 leading-none">
                <BrandLogo height={40} />
                <span className="text-2xl font-semibold tracking-tight leading-none">CreatorJobs</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
