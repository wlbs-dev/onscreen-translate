import Link from "next/link"
import AuthCard from "@/components/auth/AuthCard"
import LoginForm from "@/components/auth/LoginForm"

export const metadata = { title: "Sign in · TransEdit" }

const NOTICES: Record<string, string> = {
  disabled: "Your account has been disabled. Contact the person who invited you.",
}

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const next = typeof sp.next === "string" ? sp.next : undefined
  const reason = typeof sp.reason === "string" ? sp.reason : ""
  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back. Sign in to your pilot account."
      footer={
        <>
          Forgot your password? Ask your admin for a reset link.
          <br />
          Have an invite? <Link href="/signup" className="text-foreground underline underline-offset-4">Create your account</Link>
          {" · "}
          <Link href="/#waitlist" className="text-foreground underline underline-offset-4">Join the waitlist</Link>
        </>
      }
    >
      <LoginForm next={next} notice={NOTICES[reason]} />
    </AuthCard>
  )
}
