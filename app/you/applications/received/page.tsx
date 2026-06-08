import { redirect } from "next/navigation";

export default function ReceivedApplicationsRedirect() {
  redirect("/activity?tab=applicants");
}

