import type { NextConfig } from "next";
import path from "path";

// The README keeps every setting in the repo-root .env (the Python scripts
// read it too). Next only loads loomv2/.env*, so load the root one here as
// well. Variables already in the environment win.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "..", ".env"));
} catch {}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
