// Root.tsx
"use client"
import { useState } from "react"
import Dashboard from "../components/Dashboard"
import UploadModal from "../components/UploadModal"
import Editor from "../components/Editor"
import { TranslationSettingsProvider } from "../components/TranslationSettings"

type Screen = { view: "dashboard" } | { view: "editor"; jobId: string }

function Root() {
  const [screen, setScreen] = useState<Screen>({ view: "dashboard" })
  const [uploadModalOpen, setUploadModalOpen] = useState(false)

  return (
    <>
      {screen.view === "dashboard" && (
        <Dashboard
          onOpenJob={(jobId) => setScreen({ view: "editor", jobId })}
          onNewJob={() => {
  console.log("onNewJob fired")
  setUploadModalOpen(true)
}}
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

export default function Page() {
  return (
    <TranslationSettingsProvider>
      <Root />
    </TranslationSettingsProvider>
  )
}