/**
 * @file lib/admin-db.ts
 * @description RLS を通らない管理者接続（prisma）を使う処理だけを集めた窓口。
 *
 * なぜ分けるか:
 *   ふだんの DB 操作は lib/db.ts の withUserDb（RLS が効く）だけで行う。ただし
 *   「全員の中から定期の展開が必要な人を探す」「アプリ全体のレシート読み取り回数を数える」のように
 *   1人の権限では見えないものが要る処理がある。それをここに閉じ込め、
 *   - 引数は検証済みの値だけ（ユーザー ID は JWT 由来、日付は JST の今日）
 *   - 返すのは必要最小限（ID や件数）で、他人の取引の中身は返さない
 *   とする。eslint で、このファイル以外から prisma を直接 import することを禁止している。
 */

import { prisma } from "./prisma";
import { dateOnlyToDb } from "./date/jst";

/** 今日まで展開が済んでいない有効な定期を持つ人の ID（定期実行 R5 用） */
export async function listUserIdsWithPendingFixedCosts(today: string): Promise<string[]> {
  const rows = await prisma.fixedCost.findMany({
    where: {
      isActive: true,
      startDate: { lte: dateOnlyToDb(today) },
      OR: [{ generatedThrough: null }, { generatedThrough: { lt: dateOnlyToDb(today) } }],
    },
    distinct: ["userId"],
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
