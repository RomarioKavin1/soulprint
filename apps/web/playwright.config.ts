import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:3000", ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      SOULPRINT_NETWORK: process.env.SOULPRINT_NETWORK ?? "sandbox",
      // Copy lint and UI-only specs run against a fixture; full E2E sets SOULPRINT_CONFIG to the live sandbox file.
      SOULPRINT_CONFIG: process.env.SOULPRINT_CONFIG ?? new URL("./e2e/fixtures/networks.json", import.meta.url).pathname,
    },
  },
});
