import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The OAuth store is Redis-backed now, so the suite needs a namespace of its own: without
    // it a test run would wipe and rewrite whatever a locally running server has in there.
    env: { MCP_REDIS_PREFIX: "mcptest:" },
    // Serially: every case shares one Redis namespace and beforeEach wipes it, so two files
    // running at once would delete each other's state mid-test.
    fileParallelism: false,
  },
});
