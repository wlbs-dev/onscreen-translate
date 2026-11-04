import Link from "next/link"
import AuthCard from "@/components/auth/AuthCard"
import ForgotForm from "@/components/auth/ForgotForm"

export const metadata = { title: "Forgot password · TransEdit" }

export default function ForgotPage() {
  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter the email you signed up with and we'll send you a link to choose a new password."
      footer={<Link href="/login" className="text-foreground underline underline-offset-4">Back to sign in</Link>}
    >
      <ForgotForm />
    </AuthCard>
  )
}
