import Link from "next/link"
import AuthCard from "@/components/auth/AuthCard"
import SignupForm from "@/components/auth/SignupForm"
import { countUsers } from "@/lib/users"
import { signupMode } from "@/lib/invites"

export const dynamic = "force-dynamic"
export const metadata = { title: "Create account · TransEdit" }

export default async function SignupPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const invite = typeof sp.invite === "string" ? sp.invite : undefined
  const bootstrap = countUsers() === 0
  const needsInvite = !bootstrap && signupMode() === "invite"

  return (
    <AuthCard
      title={bootstrap ? "Create the admin account" : "Create your account"}
      subtitle={
        bootstrap
          ? "No accounts exist yet. This first account becomes the admin, who can invite pilot users."
          : needsInvite
            ? "TransEdit is in a private pilot. You'll need the invite code you were sent."
            : "Start localizing the on-screen text in your videos."
      }
      footer={
        <>
          Already have an account? <Link href="/login" className="text-foreground underline underline-offset-4">Sign in</Link>
          {needsInvite && (
            <>
              {" · "}No invite? <Link href="/#waitlist" className="text-foreground underline underline-offset-4">Join the waitlist</Link>
            </>
          )}
        </>
      }
    >
      <SignupForm invite={invite} needsInvite={needsInvite} />
    </AuthCard>
  )
}
