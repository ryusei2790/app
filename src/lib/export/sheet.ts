/**
 * @file lib/export/sheet.ts
 * @description Google スプレッドシートへの書き出し（mywork#591 案A・範囲①）。
 *
 * 取引の行（loadCsvRows と同じ CsvExportRow）から、Sheets API `spreadsheets.create` にそのまま渡せる本文を作る。
 *   - シート「取引」: 日付・収支・金額・カテゴリー・メモ（日付の古い順）
 *   - シート「月次集計」: 月・収入・支出・差額＋支出カテゴリー別の列（月の古い順）
 *
 * DB にも通信にも触らない純粋関数（単体テストで形を固定する）。Google へ送るのはブラウザ（SheetExportButton）。
 *
 * セルは userEnteredValue の stringValue / numberValue で入れる。なぜ: stringValue は式として解釈されないので、
 * メモが「=HYPERLINK(...)」でも式にならない（CSV の neutralizeFormula のような ' 付けが要らず、中身がそのまま残る）。
 */

import type { CsvExportRow } from "./kakebo-csv";

/** 月次集計の1行 */
export interface MonthlySummary {
  /** YYYY-MM */
  month: string;
  income: number;
  expense: number;
  /** 支出のカテゴリー名 → 円（カテゴリー無しは「未分類」） */
  byCategory: Record<string, number>;
}

export const UNCATEGORIZED = "未分類";
export const TX_HEADER = ["日付", "収支", "金額", "カテゴリー", "メモ"] as const;
export const MONTHLY_FIXED_HEADER = ["月", "収入", "支出", "差額"] as const;

/**
 * 取引を月ごとに足し上げる。予定（未来日の取引）も CSV と同じく含める。
 * 並びは月の古い順（YYYY-MM の文字列順＝時間順）。
 */
export function summarizeMonthly(rows: readonly CsvExportRow[]): MonthlySummary[] {
  const byMonth = new Map<string, MonthlySummary>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    let m = byMonth.get(month);
    if (!m) {
      m = { month, income: 0, expense: 0, byCategory: {} };
      byMonth.set(month, m);
    }
    if (r.type === "income") {
      m.income += r.amount;
    } else {
      m.expense += r.amount;
      const cat = r.categoryName ?? UNCATEGORIZED;
      m.byCategory[cat] = (m.byCategory[cat] ?? 0) + r.amount;
    }
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * 月次集計の列に出す支出カテゴリー。全期間の支出の多い順（よく使う費目が左に来て、スマホでも見やすい）。
 * 同額は名前順で、毎回同じ並びにする。
 */
export function expenseCategoryColumns(months: readonly MonthlySummary[]): string[] {
  const total = new Map<string, number>();
  for (const m of months) for (const [cat, yen] of Object.entries(m.byCategory)) total.set(cat, (total.get(cat) ?? 0) + yen);
  return [...total.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([cat]) => cat);
}

type Cell = { userEnteredValue: { stringValue: string } | { numberValue: number } };
const str = (s: string): Cell => ({ userEnteredValue: { stringValue: s } });
const num = (n: number): Cell => ({ userEnteredValue: { numberValue: n } });
const rowData = (cells: Cell[]) => ({ values: cells });

/** スプシの名前（Drive に並ぶ名前）。日付は JST の今日 */
export const sheetTitle = (today: string) => `家計簿_${today}`;

/**
 * Sheets API `POST /v4/spreadsheets` の本文を作る。
 * 金額は numberValue（スプシ側で足し算・グラフにできるように）、見出し行は固定表示にする。
 */
export function buildSpreadsheet(rows: readonly CsvExportRow[], today: string) {
  // 1) 取引シート: 日付の古い順（同じ日は渡した順＝安定ソート）
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const txRows = [
    rowData(TX_HEADER.map(str)),
    ...sorted.map((r) =>
      rowData([str(r.date), str(r.type === "income" ? "収入" : "支出"), num(r.amount), str(r.categoryName ?? ""), str(r.note ?? "")])
    ),
  ];

  // 2) 月次集計シート: 固定の4列のあとに支出カテゴリー別の列
  const months = summarizeMonthly(rows);
  const cats = expenseCategoryColumns(months);
  const monthlyRows = [
    rowData([...MONTHLY_FIXED_HEADER, ...cats].map(str)),
    ...months.map((m) =>
      rowData([str(m.month), num(m.income), num(m.expense), num(m.income - m.expense), ...cats.map((c) => num(m.byCategory[c] ?? 0))])
    ),
  ];

  const sheet = (sheetId: number, title: string, data: ReturnType<typeof rowData>[]) => ({
    properties: { sheetId, title, gridProperties: { frozenRowCount: 1 } },
    data: [{ startRow: 0, startColumn: 0, rowData: data }],
  });

  return {
    properties: { title: sheetTitle(today), locale: "ja_JP", timeZone: "Asia/Tokyo" },
    sheets: [sheet(0, "取引", txRows), sheet(1, "月次集計", monthlyRows)],
  };
}

export type SpreadsheetBody = ReturnType<typeof buildSpreadsheet>;
