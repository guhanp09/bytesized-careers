import { redirect } from "next/navigation";

export default function ReceivedApplicationsRedirect() {
  redirect("/applications?view=hiring");
}
