import type { DemoAccount } from "./config.ts";

/** Service accounts (governance, relayer) stay on the server; only people go to the browser. */
export function publicDemoAccounts(all: DemoAccount[]): DemoAccount[] {
  return all.filter((a) => a.role !== "governance" && a.role !== "relayer");
}
