// Start the production server on all interfaces — only with auth on.
// The API runs scripts that spend your Sarvam/OpenAI credits, so a public
// bind without APP_PASSWORD is refused unless ALLOW_NO_AUTH=1 (e.g. when
// another auth layer sits in front).
import { spawn } from "node:child_process"

if (!process.env.APP_PASSWORD && process.env.ALLOW_NO_AUTH !== "1") {
  console.error(
    "[start] Refusing to listen on 0.0.0.0 without APP_PASSWORD.\n" +
    "        Set APP_PASSWORD, or ALLOW_NO_AUTH=1 if something else handles auth."
  )
  process.exit(1)
}

const port = process.env.PORT ?? "3000"
const child = spawn("node", ["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", port], {
  stdio: "inherit",
})
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig))
child.on("exit", (code) => process.exit(code ?? 0))
