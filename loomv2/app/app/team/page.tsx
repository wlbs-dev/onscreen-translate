import { redirect } from "next/navigation"
import { currentUser } from "@/lib/access"
import TeamPanel from "@/components/team/TeamPanel"

export const dynamic = "force-dynamic"
export const metadata = { title: "Team · TransEdit" }

export default async function TeamPage() {
  if (!(await currentUser())) redirect("/login?next=/app/team")
  return <TeamPanel />
}
