import { notFound } from "next/navigation";

import SmartTypingTestClient from "./SmartTypingTestClient";

export default function SmartTypingTestPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <SmartTypingTestClient />;
}
