import Link from "next/link"
import AuthCard from "@/components/auth/AuthCard"
import SignupForm from "@/components/auth/SignupForm"
import AcceptInvite from "@/components/auth/AcceptInvite"
import { currentUser } from "@/lib/access"
import { countUsers, getUserByEmail, getUserById } from "@/lib/users"
import { getInvite, inviteProblem, signupMode } from "@/lib/invites"
import { getTeam, isMember } from "@/lib/teams"

export const dynamic = "force-dynamic"
export const metadata = { title: "Create account · TransEdit" }

const linkCls = "text-foreground underline underline-offset-4"

export default async function SignupPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const invite = typeof sp.invite === "string" ? sp.invite : undefined
  const bootstrap = countUsers() === 0
  const needsInvite = !bootstrap && signupMode() === "invite"

  // Team invites: who's inviting to what
  const inv = invite ? getInvite(invite) : undefined
  const team = inv?.teamId ? getTeam(inv.teamId) : undefined
  const inviter = inv ? getUserById(inv.createdBy) : undefined
  const signupHref = `/signup?invite=${encodeURIComponent(invite ?? "")}`

  const me = await currentUser()
  if (me && team && inv) {
    // Signed in: accept instead of creating another account
    const problem = isMember(team, me.id) ? null : inviteProblem(inv, me.email)
    return (
      <AuthCard
        title={`Join ${team.name}`}
        subtitle={<>{inviter?.name ?? "A teammate"} invited you to share videos in <b>{team.name}</b>. You&apos;re signed in as <b>{me.email}</b>.</>}
        footer={<Link href="/app" className={linkCls}>Back to your videos</Link>}
      >
        {isMember(team, me.id)
          ? <p className="text-sm">You&apos;re already in this team. <Link href="/app" className={linkCls}>Open it</Link></p>
          : problem
            ? <p className="text-sm text-destructive" role="alert">{problem} Sign out and use the account it was sent to.</p>
            : <AcceptInvite invite={inv.code} teamName={team.name} />}
      </AuthCard>
    )
  }
  if (me) {
    return (
      <AuthCard title="You're already signed in" subtitle={<>Signed in as <b>{me.email}</b>.</>}
        footer={<Link href="/app" className={linkCls}>Go to your videos</Link>}>
        <span />
      </AuthCard>
    )
  }

  // An invite to an existing account: sign in to accept it
  const existingAccount = team && inv?.email && !inv.usedBy ? getUserByEmail(inv.email) : undefined

  return (
    <AuthCard
      title={team ? `Join ${team.name} on TransEdit` : bootstrap ? "Create the admin account" : "Create your account"}
      subtitle={
        team
          ? <>{inviter?.name ?? "A teammate"} invited you to <b>{team.name}</b>. Create your account to see and edit the team&apos;s videos.</>
          : bootstrap
            ? "No accounts exist yet. This first account becomes the admin, who can invite pilot users."
            : needsInvite
              ? "TransEdit is in a private pilot. You'll need the invite code you were sent."
              : "Start localizing the on-screen text in your videos."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link href={team ? `/login?next=${encodeURIComponent(signupHref)}` : "/login"} className={linkCls}>
            Sign in{team ? " to accept" : ""}
          </Link>
          {needsInvite && !team && (
            <>
              {" · "}No invite? <Link href="/#waitlist" className={linkCls}>Join the waitlist</Link>
            </>
          )}
        </>
      }
    >
      {existingAccount ? (
        <p className="text-sm" data-testid="invite-existing">
          {inv?.email} already has an account.{" "}
          <Link href={`/login?next=${encodeURIComponent(signupHref)}`} className={linkCls}>Sign in to accept the invite</Link>
        </p>
      ) : (
        <SignupForm invite={invite} needsInvite={needsInvite} email={team ? inv?.email : undefined} />
      )}
    </AuthCard>
  )
}
