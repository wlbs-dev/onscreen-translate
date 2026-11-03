// lib/feedback.ts — in-app feedback from pilot users in <WORKSPACE>/feedback.json.
import path from "path"
import { randomUUID } from "crypto"
import { WORKSPACE } from "./workspace"
import { readJsonFile, writeJsonFileAtomic } from "./jsonFile"

export interface Feedback {
  id: string
  userId: string
  email: string
  jobId?: string
  message: string
  rating?: number // 1–5
  createdAt: number
  userAgent: string
}

const FEEDBACK_FILE = path.join(WORKSPACE, "feedback.json")

export function listFeedback(): Feedback[] {
  const entries = readJsonFile<Feedback[]>(FEEDBACK_FILE, [])
  return Array.isArray(entries) ? entries : []
}

export function addFeedback(entry: Omit<Feedback, "id" | "createdAt">): Feedback {
  const entries = listFeedback()
  const fb: Feedback = { id: randomUUID(), createdAt: Date.now(), ...entry }
  entries.push(fb)
  writeJsonFileAtomic(FEEDBACK_FILE, entries)
  return fb
}
