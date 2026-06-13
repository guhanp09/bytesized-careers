import { redirect } from "next/navigation";

export default function ApplicationsRedirect() {
  redirect("/you?tab=applications");
}
