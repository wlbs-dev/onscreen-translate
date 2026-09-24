// Root.tsx
"use client"
import { useState } from "react"
import Dashboard from "../components/Dashboard"
import UploadModal from "../components/UploadModal"
import Editor from "../components/Editor"

type Screen = { view: "dashboard" } | { view: "editor"; jobId: string }

export default function Root() {
  const [screen, setScreen] = useState<Screen>({ view: "dashboard" })
  const [uploadModalOpen, setUploadModalOpen] = useState(false)

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
          onBack={() => setScreen({ view: "dashboard" })}
        />
      )}
      <UploadModal
        key={uploadModalOpen ? "open" : "closed"}
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onReady={(jobId) => {
          setUploadModalOpen(false)
          // setScreen({ view: "editor", jobId })
        }}
      />
    </>
  )
}