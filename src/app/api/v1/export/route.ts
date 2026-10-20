/**
 * @file api/v1/export/route.ts
 * @description 書き出し（mywork#425 第2弾、設計書 4-11、テスト X1・X2・X6）。
 *   GET /api/v1/export?format=kakebo-csv … 家計簿アプリ形式 CSV（BOM 付き UTF-8。他のアプリへ移す・表計算用）
 *   GET /api/v1/export?format=full-json  … 完全形式 JSON（復元用のバックアップ）
 *   GET /api/v1/export?format=sheet-json … Sheets API に渡すスプシの本文（取引＋月次集計、mywork#591）。
 *     ブラウザが本人の Google に送る。サーバーは Google と通信しない（トークンも受け取らない）
 * どちらも添付ファイル（Content-Disposition: attachment）としてブラウザに返すだけで、サーバーには残さない。
 * DB には withUserDb（RLS が効く）経由でだけ触る。中身はログに出さない（S11）。
 */

import { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { error, requireAuth } from "@/lib/api-helpers";
import { todayJst } from "@/lib/date/jst";
import { EXPORT_FORMATS, backupFilename, loadCsvRows, toKakeboCsv, type ExportFormat } from "@/lib/export/kakebo-csv";
import { buildBackup } from "@/lib/export/full-json";
import { buildSpreadsheet } from "@/lib/export/sheet";

/** ファイルとして返す。キャッシュさせない（家計の中身が端末や中継に残らないように） */
function attachment(body: string, contentType: string, filename: string) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

const FORMATS = [...EXPORT_FORMATS, "sheet-json"] as const;

/** GET /api/v1/export?format=kakebo-csv|full-json|sheet-json */
export async function GET(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const format = request.nextUrl.searchParams.get("format");
  if (!FORMATS.includes(format as (typeof FORMATS)[number])) {
    return error("VALIDATION_ERROR", "format は kakebo-csv・full-json・sheet-json のどれかです", 422);
  }
  const today = todayJst();

  try {
    if (format === "kakebo-csv") {
      const rows = await withUserDb(user.id, (db) => loadCsvRows(db, user.id));
      return attachment(toKakeboCsv(rows), "text/csv; charset=utf-8", backupFilename("kakebo-csv", today));
    }
    if (format === "sheet-json") {
      // ファイルではなく画面の部品が読む JSON。キャッシュさせない
      const rows = await withUserDb(user.id, (db) => loadCsvRows(db, user.id));
      return Response.json({ data: buildSpreadsheet(rows, today) }, { headers: { "cache-control": "no-store" } });
    }
    const backup = await withUserDb(user.id, (db) => buildBackup(db, user.id));
    return attachment(JSON.stringify(backup, null, 2), "application/json; charset=utf-8", backupFilename("full-json", today));
  } catch {
    // 中身はログに出さない
    return error("INTERNAL_ERROR", "書き出しに失敗しました", 500);
  }
}
