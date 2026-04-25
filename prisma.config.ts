/**
 * @file prisma.config.ts
 * @description Prisma 7 の設定ファイル。
 * Prisma 7 から schema.prisma の datasource に url を書く方式が廃止され、
 * このファイルで接続URLを管理するようになった。
 */

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Supabase CLI ローカルの接続URL（.env.local から読み込む）
    url: process.env["DATABASE_URL"]!,
  },
});
