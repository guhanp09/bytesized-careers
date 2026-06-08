import { redirect } from "next/navigation";

export default function SentApplicationsRedirect() {
  redirect("/activity?tab=applications");
}

