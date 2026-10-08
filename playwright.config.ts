/**
 * @file playwright.config.ts
 * @description Playwright（E2E・画面テスト W1〜W6）の設定。
 * - 既定はスマホ幅（375px）。テスト一覧 W3 の「スマホ幅で導線が通る」に合わせる
 * - 開発サーバーは E2E 専用にポート 3100 で起動する（3000 で動いている別のアプリを誤って使わないため）
 * - 接続先は `supabase status` から読む（.env.local は不要）。127.0.0.1 / localhost 以外なら止める
 * - レシートの AI は必ずモック（RECEIPT_PARSER=mock）。お金のかかる API には繋がない
 * 事前に `supabase start` が必要。実行は `npm run test:e2e`。
 */

import { defineConfig, devices } from "@playwright/test";
import { localSupabase } from "./tests/e2e/helpers";

const PORT = 3100;
const sb = localSupabase();

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-375",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: sb.apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
      DATABASE_URL: sb.dbUrl,
      RECEIPT_PARSER: "mock",
      OWNER_USER_IDS: "",
    },
  },
});
