/**
 * @file api/v1/import/[id]/route.ts
 * @description 取り込みの取り消し（mywork#425 第2弾、設計書 4-10・4-11、テスト X5・X6）。
 *   DELETE /api/v1/import/:id … その取り込みで作った取引を消し、履歴を「取り消し済み」にする（lib/import/undo.ts）
 * 他人の取り込み・無い id は 404（存在を漏らさない）。取り消し済みをもう一度は 409。
 */

import { NextRequest } from "next/server";
import { isUuid, withUserDb } from "@/lib/db";
import { error, ok, requireAuth } from "@/lib/api-helpers";
import { undoImport } from "@/lib/import/undo";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/v1/import/:id */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  if (!isUuid(id)) return error("NOT_FOUND", "取り込みが見つかりません", 404);

  try {
    const result = await withUserDb(user.id, (db) => undoImport(db, user.id, id));
    if (result.status === "not_found") return error("NOT_FOUND", "取り込みが見つかりません", 404);
    if (result.status === "already_undone") return error("CONFLICT", "この取り込みはもう取り消してあります", 409);
    return ok({ import_id: id, deleted_count: result.deleted });
  } catch {
    return error("INTERNAL_ERROR", "取り消しに失敗しました（何も消えていません）", 500);
  }
}
