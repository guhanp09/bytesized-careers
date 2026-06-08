"use client";

import dynamic from "next/dynamic";

const PasswordResetPage = dynamic(() => import("../../../components/PasswordResetPage"), {
  ssr: false,
});

export default function Page() {
  return <PasswordResetPage />;
}
