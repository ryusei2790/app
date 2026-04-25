/**
 * @file lib/csv/saison.ts
 * @description セゾンカード CSV パーサー。
 * CSV の各行を transactions[] に変換する。
 */

import type { CsvPreviewRow } from "@/types/api";

interface SaisonRow {
  [key: string]: string;
}

/**
 * セゾンカード CSV データを収支プレビュー形式に変換する。
 * @param rows - papaparse が返す配列オブジェクト
 * @returns CsvPreviewRow[] - 変換済みデータ
 */
export function parseSaison(rows: SaisonRow[]): CsvPreviewRow[] {
  const results: CsvPreviewRow[] = [];

  for (const row of rows) {
    const dateRaw =
      row["利用日"] ?? row["ご利用日"] ?? row["date"] ?? "";
    const noteRaw =
      row["利用店名・商品名"] ?? row["利用店名"] ?? row["store"] ?? "";
    const amountRaw =
      row["利用金額(円)"] ?? row["利用金額"] ?? row["amount"] ?? "";

    if (!dateRaw || !amountRaw) continue;

    // 日付パース: "2026/03/15" → "2026-03-15"
    const transactionDate = dateRaw.replace(/\//g, "-").trim();

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
