/**
 * @file lib/prisma.ts
 * @description Prisma クライアントのシングルトン。
 * Prisma 7 から接続にアダプターが必要になった。
 * @prisma/adapter-pg + pg を使って Supabase PostgreSQL に接続する。
 * Next.js の開発環境ではホットリロードのたびに新しいインスタンスが生成されるため、
 * グローバル変数にキャッシュして接続数の爆発を防ぐ。
 *
 * クライアントは最初に使われたときに作る（import しただけでは作らない）。
 * next build は「page data の収集」で route を import するので、import 時に作ると
 * DATABASE_URL の無い環境（Vercel の Preview）でビルドが落ちる（2026-10-14、app#4）。
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

/** 初回に生成し、以後は同じインスタンスを返す */
function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const client = createPrismaClient();
  // 本番でも同じプロセスの中では使い回す（開発環境ではホットリロードをまたいで使い回す）
  globalForPrisma.prisma = client;
  return client;
}

/**
 * シングルトン Prisma クライアント。
 * 中身は最初のプロパティ参照（prisma.$transaction など）で作る。
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, client);
    // $transaction などのメソッドは this が client でないと動かない
    return typeof value === "function" ? value.bind(client) : value;
  },
});
