// Start the production server on all interfaces.
// Sessions are signed with SESSION_SECRET; refuse to listen publicly without
// one (a generated per-workspace secret is fine on localhost, not here).
import { spawn } from "node:child_process"
import path from "node:path"

// Same env files the app reads (next.config.ts loads the repo-root .env)
for (const f of [path.resolve("..", ".env"), path.resolve(".env")]) {
  try { process.loadEnvFile(f) } catch {}
}

const secret = process.env.SESSION_SECRET?.trim() ?? ""
if (secret.length < 32) {
  console.error(
    "[start] Refusing to listen on 0.0.0.0 without a SESSION_SECRET of at least 32 characters.\n" +
    "        Generate one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"\n" +
    "        and put SESSION_SECRET=... in the repo-root .env (./setup.sh does this for you)."
  )
  process.exit(1)
}

const port = process.env.PORT ?? "3000"
const child = spawn("node", ["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", port], {
  stdio: "inherit",
})
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig))
child.on("exit", (code) => process.exit(code ?? 0))
