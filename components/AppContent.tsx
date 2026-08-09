"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The marketplace normally reserves a desktop navigation rail at every width.
 * Job creation is a focused, input-heavy flow, so on phone-sized screens it gets
 * the full viewport below the shared header. The rail remains unchanged from
 * `sm` upward and every non-job-creation route keeps its existing frame.
 */
export default function AppContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const focusedJobCreation = pathname.startsWith("/post-job");

  return (
    <div className={focusedJobCreation ? "pt-14 sm:pl-20" : "pl-20 pt-14"}>
      {children}
    </div>
  );
}
