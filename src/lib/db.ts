/**
 * @file lib/db.ts
 * @description アプリが DB に触るときの唯一の入口。
 *
 * なぜ必要か:
 *   Prisma は DATABASE_URL の管理者ユーザー（postgres）で繋ぐので、そのままでは RLS が効かない。
 *   すると他人のデータを守るのはコード中の where: { userId } だけになり、1か所の書き忘れで漏れる。
 *
 * 何をするか:
 *   withUserDb(userId, fn) は1つの DB トランザクションを開き、その中だけ
 *     - ロールを authenticated に下げる（SET LOCAL ROLE）
 *     - auth.uid() が userId を返すよう JWT の claims を設定する（set_config(..., true)）
 *   ようにしてから fn を実行する。SET LOCAL / is_local=true なので、トランザクションが終われば
 *   接続は元に戻り、接続プールの他のリクエストに設定が漏れない。
 *   → fn の中のクエリには Supabase の RLS がそのまま効く（ブラウザから直接叩かれた時と同じ規則）。
 *
 * 守りは二重: route 側でも userId 絞り込みと所有確認（lib/ownership.ts）を続ける。
 * route から `@/lib/prisma` を直接 import することは eslint で禁止している（eslint.config.mjs）。
 */

import type { Prisma } from "../generated/prisma";
import { prisma } from "./prisma";

/** withUserDb の中で使う DB クライアント（Prisma のトランザクションクライアント） */
export type UserDb = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * ログイン中ユーザーとして RLS を効かせた状態で fn を実行する。
 * @param userId Supabase Auth で検証済みのユーザー ID（JWT の sub）。リクエストの body から取ってはいけない
 */
export async function withUserDb<T>(userId: string, fn: (db: UserDb) => Promise<T>): Promise<T> {
  if (!isUuid(userId)) {
    // 文字列を SQL に入れる前に形を確かめる（claims は JSON として渡すが、念のため入口で止める）
    throw new Error("withUserDb: userId が UUID ではありません");
  }
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${claims}, true)`;
      await tx.$executeRawUnsafe("SET LOCAL ROLE authenticated");
      return fn(tx);
    },
    { maxWait: 5_000, timeout: 15_000 }
  );
}
