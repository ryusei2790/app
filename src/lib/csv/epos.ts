/**
 * @file lib/csv/epos.ts
 * @description エポスカード CSV パーサー。
 * CSV の各行を transactions[] に変換する。
 * 実際のCSVヘッダーは取得後に調整が必要な場合あり。
 */

import type { CsvPreviewRow } from "@/types/api";

/**
 * エポスカード CSV の1行を表す型
 * ヘッダー例: ご利用日, ご利用先など, ご利用金額(円), 支払方法
 */
interface EposRow {
  [key: string]: string;
}

/**
 * エポスカード CSV データを収支プレビュー形式に変換する。
 * @param rows - papaparse が返す配列オブジェクト
 * @returns CsvPreviewRow[] - 変換済みデータ
 */
export function parseEpos(rows: EposRow[]): CsvPreviewRow[] {
  const results: CsvPreviewRow[] = [];

  for (const row of rows) {
    // ヘッダー名の揺れに対応するため、複数のキー名を試みる
    const dateRaw =
      row["ご利用日"] ?? row["利用日"] ?? row["date"] ?? "";
    const noteRaw =
      row["ご利用先など"] ?? row["ご利用先"] ?? row["store"] ?? "";
    const amountRaw =
      row["ご利用金額(円)"] ?? row["ご利用金額"] ?? row["amount"] ?? "";

    if (!dateRaw || !amountRaw) continue; // 空行・ヘッダー行をスキップ

    // 日付パース: "2026/03/15" → "2026-03-15"
    const transactionDate = dateRaw.replace(/\//g, "-").trim();

    // 金額パース: カンマ・円記号を除去
    const amount = parseFloat(amountRaw.replace(/[,¥]/g, "").trim());
    if (isNaN(amount) || amount <= 0) continue;

    results.push({
      transaction_date: transactionDate,
      note: noteRaw.trim(),
      amount,
    });
  }

  return results;
}
