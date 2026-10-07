/**
 * @file playwright.config.ts
 * @description Playwright（E2E・画面テスト）の設定。今回は導入と設定のみで、
 * W1〜W6 のテストは次の段階で tests/e2e/ に書く。
 * - 既定はスマホ幅（375px）。テスト一覧 W3 の「スマホ幅で導線が通る」に合わせる
 * - webServer で `npm run dev` を自動起動する（事前に `supabase start` と .env.local のローカル値が必要）
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-375",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
