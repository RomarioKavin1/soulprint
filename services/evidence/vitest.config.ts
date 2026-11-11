import { defineConfig } from "vitest/config";
// Each test boots an in-process Postgres (PGlite) and sharp; under load (the demo stack running
// alongside) that exceeds vitest's 5 s default without anything being wrong.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
