/**
 * @file lib/prisma.ts
 * @description Prisma クライアントのシングルトン。
 * Prisma 7 から接続にアダプターが必要になった。
 * @prisma/adapter-pg + pg を使って Supabase PostgreSQL に接続する。
 * Next.js の開発環境ではホットリロードのたびに新しいインスタンスが生成されるため、
 * グローバル変数にキャッシュして接続数の爆発を防ぐ。
 */

import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

// PrismaClient のグローバル型拡張（TypeScript の型安全性を保ちつつグローバル変数を使う）
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Prisma 7 のアダプター経由クライアントを生成する。
 * DATABASE_URL 環境変数から接続文字列を読み取る。
 */
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL 環境変数が設定されていません");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/** シングルトン Prisma クライアント */
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// 開発環境でのみグローバルにキャッシュ（本番では毎回生成してメモリリークを防ぐ）
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
