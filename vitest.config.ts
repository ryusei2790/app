/**
 * @file vitest.config.ts
 * @description Vitest の設定。テストを2つのプロジェクトに分ける。
 * - unit: DB を使わない純粋関数のテスト（`npm test`）。いつでも数秒で回る
 * - db:   Supabase ローカル（RLS 有効）に繋ぐ結合・API テスト（`npm run test:db`）。
 *         事前に `supabase start` が必要。接続先は globalSetup が `supabase status` から取り、
 *         127.0.0.1 / localhost 以外の DB には絶対に繋がない（クラウド誤接続の防止）
 * TZ は Asia/Tokyo 固定。本番（Vercel = UTC）と違う TZ で回すことで、
 * サーバーのローカル時刻に依存した日付計算のバグを炙り出す（T3）。
 */

import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(__dirname, "src") };

export default defineConfig({
  resolve: { alias },
  test: {
    env: { TZ: "Asia/Tokyo" },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          env: { TZ: "Asia/Tokyo" },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts", "tests/api/**/*.test.ts"],
          env: { TZ: "Asia/Tokyo" },
          globalSetup: ["tests/helpers/global-setup.ts"],
          setupFiles: ["tests/helpers/setup-env.ts"],
          // 同じ DB を共有するので、ファイル単位でも直列に回す（テスト間の干渉を防ぐ）
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
