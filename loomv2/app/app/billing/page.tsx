import { redirect } from "next/navigation"
import { currentUser } from "@/lib/access"
import BillingPanel from "@/components/billing/BillingPanel"

export const dynamic = "force-dynamic"
export const metadata = { title: "Plan & billing · TransEdit" }

export default async function BillingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await currentUser())) redirect("/login?next=/app/billing")
  const { checkout } = await searchParams
  return <BillingPanel checkout={checkout === "success" || checkout === "cancelled" ? checkout : undefined} />
}
