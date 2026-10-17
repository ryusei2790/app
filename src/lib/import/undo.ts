/**
 * @file lib/import/undo.ts
 * @description 取り込みの取り消し（mywork#425 第2弾、設計書 4-10・4-11、テスト X5）。
 *
 * その取り込み（csv_import_id）で作った取引を消し、履歴を「取り消し済み」（status = 'undone'）にする。
 *   - 取引は物理削除する（画面で論理削除していた行も含む）。行の目印（import_key）も消えるので、
 *     直した CSV を同じ目印のままもう一度取り込める（論理削除だと目印が残り「取り込み済み」と判定されて入らない）
 *   - その取り込みで作った定期・カテゴリー・口座は残す（他の取引や本人の設定が使っているかもしれないため）
 *   - 履歴の行はファイル名・件数を残す（いつ何を入れて取り消したかが分かるように）
 *
 * withUserDb の中で呼ぶ。他人の取り込みは RLS で見えず、where: { userId } でも絞るので not_found になる。
 */

import type { UserDb } from "@/lib/db";

export type UndoResult =
  | { status: "ok"; deleted: number }
  | { status: "not_found" }
  | { status: "already_undone" };

export async function undoImport(db: UserDb, userId: string, importId: string): Promise<UndoResult> {
  // 1. 自分の取り込みか（他人のもの・無いものは同じ not_found にして、存在を漏らさない）
  const found = await db.csvImport.findFirst({ where: { id: importId, userId }, select: { id: true, status: true } });
  if (!found) return { status: "not_found" };
  if (found.status === "undone") return { status: "already_undone" };

  // 2. その取り込みの取引を消す（レシートは取引の削除で一緒に消える: ON DELETE CASCADE）
  const deleted = await db.transaction.deleteMany({ where: { userId, csvImportId: importId } });

  // 3. 履歴を「取り消し済み」に
  await db.csvImport.update({ where: { id: importId }, data: { status: "undone" } });
  return { status: "ok", deleted: deleted.count };
}
