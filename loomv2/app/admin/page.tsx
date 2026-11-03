import { notFound } from "next/navigation"
import { currentUser } from "@/lib/access"
import AdminPanel from "@/components/admin/AdminPanel"

export const dynamic = "force-dynamic"
export const metadata = { title: "Admin · TransEdit" }

export default async function AdminPage() {
  const user = await currentUser()
  // Members (and anyone else) get a plain 404
  if (user?.role !== "admin") notFound()
  return <AdminPanel />
}
