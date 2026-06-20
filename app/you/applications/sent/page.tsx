import { redirect } from "next/navigation";

export default function SentApplicationsRedirect() {
  redirect("/applications?view=talent");
}
