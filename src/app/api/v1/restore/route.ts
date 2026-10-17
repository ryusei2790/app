/**
 * @file api/v1/restore/route.ts
 * @description 完全形式 JSON の復元（mywork#425 第2弾、設計書 4-11、テスト X3・X6）。
 *   POST /api/v1/restore  本文 = 書き出した完全形式 JSON そのもの（application/json）
 * 空の帳簿にだけ入れる（空でなければ 409。先に全削除）。形が違う・参照先の無い行があれば 422、同じ id の行が既にあれば 409。
 * 1つのトランザクションで入れるので、途中で止まっても何も残らない。中身はログに出さない（S11）。
 */

import { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { error, ok, requireAuth } from "@/lib/api-helpers";
import { MAX_RESTORE_BYTES, RestoreError, parseBackup, restoreBackup } from "@/lib/export/full-json";

/** POST /api/v1/restore */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  // 1. 大きさ（Vercel の関数は本文 4.5MB まで。手元でも同じ上限で止める）
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_RESTORE_BYTES) return error("PAYLOAD_TOO_LARGE", "ファイルは 4MB までです", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_RESTORE_BYTES) {
    return error("PAYLOAD_TOO_LARGE", "ファイルは 4MB までです", 413);
  }

  // 2. 形を確かめる（DB に触る前）
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return error("VALIDATION_ERROR", "JSON として読めません", 422);
  }
  const parsed = parseBackup(json);
  if (!parsed.ok) return error("VALIDATION_ERROR", parsed.reason, 422);

  // 3. 入れる
  try {
    const restored = await withUserDb(user.id, (db) => restoreBackup(db, user.id, parsed.backup));
    return ok({ restored });
  } catch (e) {
    if (e instanceof RestoreError) {
      return error(e.kind === "invalid" ? "VALIDATION_ERROR" : "CONFLICT", e.message, e.kind === "invalid" ? 422 : 409);
    }
    // トランザクションごと巻き戻っているので何も残っていない。中身はログに出さない
    return error("INTERNAL_ERROR", "復元に失敗しました", 500);
  }
}
