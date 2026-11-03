// AppShell.tsx — the signed-in app at /app (Dashboard ↔ Editor).
// /app?job=<id> opens that job's editor directly (links from /admin feedback).
"use client"
import { useState } from "react"
import Dashboard from "./Dashboard"
import UploadModal from "./UploadModal"
import Editor from "./Editor"

type Screen = { view: "dashboard" } | { view: "editor"; jobId: string }

export default function AppShell({ initialJobId }: { initialJobId?: string }) {
  const [screen, setScreen] = useState<Screen>(
    initialJobId ? { view: "editor", jobId: initialJobId } : { view: "dashboard" }
  )
  const [uploadModalOpen, setUploadModalOpen] = useState(false)

  const backToDashboard = () => {
    // Drop ?job= so a reload doesn't reopen the editor
    if (window.location.search) window.history.replaceState(null, "", "/app")
    setScreen({ view: "dashboard" })
  }

  return (
    <>
      {screen.view === "dashboard" && (
        <Dashboard
          onOpenJob={(jobId) => setScreen({ view: "editor", jobId })}
          onNewJob={() => setUploadModalOpen(true)}
        />
      )}
      {screen.view === "editor" && (
        <Editor
          jobId={screen.jobId}
          onBack={backToDashboard}
        />
      )}
      <UploadModal
        key={uploadModalOpen ? "open" : "closed"}
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onReady={() => setUploadModalOpen(false)}
      />
    </>
  )
}
