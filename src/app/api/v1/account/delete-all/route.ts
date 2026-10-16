/**
 * @file api/v1/account/delete-all/route.ts
 * @description 全削除（mywork#425 第2弾、設計書 4-11、テスト X4・X6）。
 *   POST /api/v1/account/delete-all  本文 { "confirm": "削除" }
 * 確認語が完全に一致しなければ 422 で何も消さない。本人の全表を1トランザクションで消し、auth のユーザーは残す。
 * 直前のバックアップ（完全形式）は画面が必須にしている（落とすまで確認語の欄と削除ボタンが押せない）。
 * GET では消さない（リンクのプリフェッチや誤クリックで消えないように）。
 */

import { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { error, ok, readJsonBody, requireAuth } from "@/lib/api-helpers";
import { DELETE_CONFIRM_WORD, deleteAllData } from "@/lib/export/delete-all";

/** POST /api/v1/account/delete-all */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { body, response: bad } = await readJsonBody(request);
  if (bad) return error("VALIDATION_ERROR", `確認のため confirm に「${DELETE_CONFIRM_WORD}」を入れてください`, 422);
  if (body.confirm !== DELETE_CONFIRM_WORD) {
    return error("VALIDATION_ERROR", `確認のため confirm に「${DELETE_CONFIRM_WORD}」を入れてください`, 422);
  }

  try {
    const deleted = await withUserDb(user.id, (db) => deleteAllData(db, user.id));
    return ok({ deleted });
  } catch {
    // 途中で失敗したらトランザクションごと巻き戻り、何も消えていない
    return error("INTERNAL_ERROR", "削除に失敗しました（何も消えていません）", 500);
  }
}
