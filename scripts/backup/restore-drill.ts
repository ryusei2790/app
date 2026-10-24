/**
 * @file scripts/backup/restore-drill.ts
 * @description 年1回の復元テスト（mywork#764 ②、設計書 8節）。**ローカル Supabase にだけ**繋ぐ。
 *   1. 暗号化されたバックアップを age の秘密鍵で戻し、parseBackup で形を確かめる
 *   2. 新しい空のユーザー（DRILL_USER_ID、ローカルの auth.users に作っておく）に restoreBackup で入れる
 *   3. 同じユーザーで buildBackup し、元と件数が同じかを出す（金額は出さない）。
 *      中身のハッシュも出すが、共通カテゴリーの id は DB ごとに違う（復元で付け直す）ので、本番のファイルでは一致しなくてよい
 *
 * 使い方: AGE_IDENTITY=… DRILL_USER_ID=… DATABASE_URL=<ローカル> npx tsx --tsconfig tsconfig.json scripts/backup/restore-drill.ts <ファイル.age>
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withUserDb } from "@/lib/db";
import { buildBackup, parseBackup, restoreBackup } from "@/lib/export/full-json";
import { decryptBackup } from "@/lib/backup/weekly";

/** 書き出しの日時を除いた中身のハッシュ（復元前後で同じなら戻せている） */
export function dataHash(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  // 本番では試さない（procedures.md「全削除・復元の動作確認はローカルだけ」）
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("DATABASE_URL がローカルではありません");
  const file = process.argv[2];
  const identity = process.env.AGE_IDENTITY;
  const userId = process.env.DRILL_USER_ID;
  if (!file || !identity || !userId) throw new Error("ファイル・AGE_IDENTITY・DRILL_USER_ID が要ります");

  const parsed = parseBackup(JSON.parse(await decryptBackup(await readFile(file), identity)));
  if (!parsed.ok) throw new Error(`形が違います: ${parsed.reason}`);
  await withUserDb(userId, (db) => restoreBackup(db, userId, parsed.backup));
  const again = await withUserDb(userId, (db) => buildBackup(db, userId));

  const same = JSON.stringify(parsed.backup.counts) === JSON.stringify(again.counts);
  const hashSame = dataHash(parsed.backup.data) === dataHash(again.data);
  console.log(JSON.stringify({ same, hashSame, before: parsed.backup.counts, after: again.counts }));
  if (!same) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(String(e?.message ?? e).slice(0, 300));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
