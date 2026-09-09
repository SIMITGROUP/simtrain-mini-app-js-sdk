import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const localChrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: "./test/integration",
  testMatch: "browser-flow.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    browserName: "chromium",
    headless: true,
    ...(existsSync(localChrome)
      ? { launchOptions: { executablePath: localChrome } }
      : {}),
  },
});
