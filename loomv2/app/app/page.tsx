import { redirect } from "next/navigation"
import { currentUser } from "@/lib/access"
import { isValidJobId } from "@/lib/jobPaths"
import AppShell from "@/components/AppShell"

export const dynamic = "force-dynamic"
export const metadata = { title: "Videos · TransEdit" }

export default async function AppPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // proxy.ts already checked the cookie; this also rejects disabled/deleted users
  if (!(await currentUser())) redirect("/login?next=/app")
  const { job } = await searchParams
  return <AppShell initialJobId={isValidJobId(job) ? job : undefined} />
}
