import path from "node:path";
import type { NextConfig } from "next";

// Standalone output is opt-in, and only apps/web/Dockerfile opts in.
//
// It emits a self-contained server (.next/standalone/…/server.js) carrying only the
// traced runtime deps, which is exactly what the image wants — but producing it means
// recreating pnpm's symlinked node_modules tree, and creating a symlink on Windows
// needs Developer Mode or an elevated shell. Turning it on unconditionally makes
// `pnpm build` fail on this machine with EPERM after compiling successfully, which is
// a miserable way to find out. Linux (Docker, CI) has no such restriction.
const standalone = process.env.NEXT_OUTPUT_STANDALONE === "1";

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(standalone ? { output: "standalone" as const } : {}),
  // In a pnpm workspace Next infers the trace root from the nearest lockfile, and an
  // inferred root changes where standalone/ nests server.js — which would silently
  // break the COPY paths in Dockerfile. Pin it; keep the two in step.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
