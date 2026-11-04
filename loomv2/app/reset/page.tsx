import Link from "next/link"
import AuthCard from "@/components/auth/AuthCard"
import ResetForm from "@/components/auth/ResetForm"
import { findReset } from "@/lib/resets"
import { getUserById } from "@/lib/users"

export const metadata = { title: "Reset password · TransEdit" }
export const dynamic = "force-dynamic"

export default async function ResetPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const token = typeof sp.token === "string" ? sp.token : ""
  const reset = findReset(token)
  const user = reset ? getUserById(reset.userId) : undefined
  const footer = <Link href="/login" className="text-foreground underline underline-offset-4">Back to sign in</Link>

  if (!reset || !user) {
    return (
      <AuthCard title="Link expired" footer={footer}
        subtitle="This reset link is invalid, has already been used, or is more than 24 hours old." >
        <Link href="/forgot" className="text-sm text-foreground underline underline-offset-4">Send me a new link</Link>
      </AuthCard>
    )
  }
  return (
    <AuthCard title="Set a new password" subtitle={<>For <b>{user.email}</b>. You&apos;ll be signed in, and other devices signed out.</>} footer={footer}>
      <ResetForm token={token} />
    </AuthCard>
  )
}
