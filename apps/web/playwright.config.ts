import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 8799;
const dataDir = mkdtempSync(join(tmpdir(), "persona-e2e-"));

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  workers: 1,
  webServer: {
    command: `uv run persona serve --port ${port}`,
    cwd: "../server",
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: false,
    env: {
      DATA_DIR: dataDir,
      SECRET_KEY: "e2e-secret-key-0123456789",
      LLM_PROVIDER: "mock",
      ENVIRONMENT: "development",
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      RL_AUTH_PER_MIN: "1000",
      TTS_PROVIDER: "none",
      STT_PROVIDER: "none",
    },
  },
});
