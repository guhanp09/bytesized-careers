"use client";

import dynamic from "next/dynamic";

const PostTalentPage = dynamic(() => import("../../components/PostTalentPage"), { ssr: false });

export default function Page() {
  return <PostTalentPage />;
}
