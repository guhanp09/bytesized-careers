"use client";

import dynamic from "next/dynamic";

const PostJobPage = dynamic(() => import("../../components/PostJobPage"), { ssr: false });

export default function Page() {
  return <PostJobPage />;
}
