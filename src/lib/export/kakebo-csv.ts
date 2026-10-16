/**
 * @file lib/export/kakebo-csv.ts
 * @description 家計簿アプリ形式 CSV の書き出し（mywork#425 第2弾、設計書 4-11、テスト X1）。
 *
 * 形式は取り込み（lib/csv/kakebo.ts）と同じ `金額,日付,メモ,カテゴリー名`:
 *   - 金額: 支出は負・収入は正の整数円（返金は収入の向きなので正）
 *   - 日付: YYYY/MM/DD（元の家計簿アプリと同じ）
 *   - 先頭に BOM を付けた UTF-8（Excel で開いても文字化けしない）、改行は CRLF（RFC 4180）
 *   - 予定（今日より後の日付の取引）も入れる。消した取引（deleted_at あり）は入れない
 *
 * 用途は「他のアプリへ移す・表計算で見る」。自分の kakebo に入れ直す用ではない
 * （レシート・手入力の行は行の目印を持たないので、入れ直すと重複する）。入れ直しは完全形式（full-json.ts）で。
 *
 * toKakeboCsv は DB に触らない純粋関数（単体テストで形を固定する）。loadCsvRows が withUserDb の中で行を読む。
 */

import * as Papa from "papaparse";
import type { UserDb } from "@/lib/db";
import { dbToDateOnly } from "@/lib/date/jst";
import { KAKEBO_HEADER } from "@/lib/csv/kakebo";

export const KAKEBO_CSV_BOM = "﻿";

/** 書き出す1行（向きと絶対値の金額を分けて持つ。DB の transactions と同じ持ち方） */
export interface CsvExportRow {
  /** YYYY-MM-DD */
  date: string;
  /** 絶対値の円 */
  amount: number;
  type: "income" | "expense";
  note: string | null;
  categoryName: string | null;
}

/** 書き出しの種類（GET /api/v1/export?format=） */
export type ExportFormat = "kakebo-csv" | "full-json";
export const EXPORT_FORMATS: readonly ExportFormat[] = ["kakebo-csv", "full-json"];

/**
 * ダウンロードのファイル名。英数字だけにする（Content-Disposition の filename に日本語を入れると、
 * filename* の書き方を解さない端末で名前が崩れる）。日付は JST の今日。
 */
export function backupFilename(format: ExportFormat, today: string): string {
  return format === "kakebo-csv" ? `kakebo_${today}.csv` : `kakebo-full_${today}.json`;
}

/**
 * 表計算ソフトが式として実行する先頭文字（= + @、タブ・CR、数字でない -）で始まるセルに ' を付ける。
 * なぜ: メモに「=HYPERLINK(...)」のような文字列があると、CSV を Excel で開いたときに式として動く（CSV インジェクション）。
 * 金額の列（-500 など）は数字なので対象外。読み戻すとメモの先頭に ' が残るが、元が式の文字列という珍しい場合だけ。
 */
function neutralizeFormula(cell: string): string {
  if (cell === "") return cell;
  const first = cell[0];
  const risky = first === "=" || first === "+" || first === "@" || first === "\t" || first === "\r" || (first === "-" && !/^-\d+(\.\d+)?$/.test(cell));
  return risky ? `'${cell}` : cell;
}

/** "YYYY-MM-DD" → "YYYY/MM/DD" */
const slashDate = (date: string) => date.replace(/-/g, "/");

/**
 * 行 → CSV 文字列（BOM 付き）。日付の古い順に並べる（同じ日は渡した順のまま＝安定ソート）。
 * 引用符・カンマ・改行の囲みは papaparse の unparse に任せる（自前で書くと取りこぼす）。
 */
export function toKakeboCsv(rows: readonly CsvExportRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const body = Papa.unparse(
    {
      fields: [...KAKEBO_HEADER],
      data: sorted.map((r) => [
        String(r.type === "expense" ? -r.amount : r.amount),
        slashDate(r.date),
        neutralizeFormula(r.note ?? ""),
        neutralizeFormula(r.categoryName ?? ""),
      ]),
    },
    { newline: "\r\n", quotes: false }
  );
  // 行が無いと unparse はヘッダーの後ろに改行を付けて返すので、末尾の改行をそろえてから1つ付ける
  return `${KAKEBO_CSV_BOM}${body.replace(/(\r\n)+$/, "")}\r\n`;
}

/**
 * 本人の消していない取引を CSV の行にする。withUserDb の中で呼ぶ（RLS が効く）。
 * userId でも絞る（守りは二重）。並びは日付 → 作った順で、毎回同じ CSV になるようにする。
 */
export async function loadCsvRows(db: UserDb, userId: string): Promise<CsvExportRow[]> {
  const txs = await db.transaction.findMany({
    where: { userId, deletedAt: null },
    select: { transactionDate: true, amount: true, type: true, note: true, category: { select: { name: true } } },
    orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return txs.map((t) => ({
    date: dbToDateOnly(t.transactionDate),
    amount: Number(t.amount),
    type: t.type as "income" | "expense",
    note: t.note,
    categoryName: t.category?.name ?? null,
  }));
}
