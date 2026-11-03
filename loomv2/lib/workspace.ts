// lib/workspace.ts — where runtime data lives. Kept free of other imports so
// proxy.ts can use it without pulling in the job/script helpers.
import path from "path"

// Resolve from the cwd (loomv2/) — __dirname points into .next/ once bundled
export const WORKSPACE = process.env.WORKSPACE_DIR
  ?? path.resolve(process.cwd(), "..", "workspace")
