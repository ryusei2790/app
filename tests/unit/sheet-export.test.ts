/**
 * @file tests/unit/sheet-export.test.ts
 * @description スプシ書き出し（mywork#591、lib/export/sheet.ts）の単体テスト。DB・通信を使わない純粋関数だけを見る。
 * DB を通した sheet-json の書き出しは tests/api/export-api.test.ts の G1。
 */

import { describe, expect, it } from "vitest";
import type { CsvExportRow } from "@/lib/export/kakebo-csv";
import { MONTHLY_FIXED_HEADER, TX_HEADER, UNCATEGORIZED, buildSpreadsheet, expenseCategoryColumns, summarizeMonthly } from "@/lib/export/sheet";

const row = (o: Partial<CsvExportRow>): CsvExportRow => ({ date: "2026-09-03", amount: 500, type: "expense", note: null, categoryName: null, ...o });

type Cell = { userEnteredValue: { stringValue?: string; numberValue?: number } };
const values = (sheet: { data: { rowData: { values: Cell[] }[] }[] }) =>
  sheet.data[0].rowData.map((r) => r.values.map((c) => c.userEnteredValue.stringValue ?? c.userEnteredValue.numberValue));

const rows = [
  row({ date: "2026-10-01", amount: 300, categoryName: "食費" }),
  row({ date: "2026-09-25", amount: 250000, type: "income", categoryName: "給料" }),
  row({ date: "2026-09-03", amount: 1200, categoryName: "食費", note: "ランチ" }),
  row({ date: "2026-09-10", amount: 80000, categoryName: "住居" }),
  row({ date: "2026-09-11", amount: 700 }),
];

describe("summarizeMonthly 月次集計", () => {
  it("月ごとに収入・支出・支出カテゴリー別を足し、月の古い順。カテゴリー無しは未分類", () => {
    expect(summarizeMonthly(rows)).toEqual([
      { month: "2026-09", income: 250000, expense: 81900, byCategory: { 食費: 1200, 住居: 80000, [UNCATEGORIZED]: 700 } },
      { month: "2026-10", income: 0, expense: 300, byCategory: { 食費: 300 } },
    ]);
  });

  it("取引が無ければ空", () => {
    expect(summarizeMonthly([])).toEqual([]);
  });
});

describe("expenseCategoryColumns 列の並び", () => {
  it("全期間の支出の多い順（収入のカテゴリーは出ない）", () => {
    expect(expenseCategoryColumns(summarizeMonthly(rows))).toEqual(["住居", "食費", UNCATEGORIZED]);
  });
});

describe("buildSpreadsheet Sheets API の本文", () => {
  const body = buildSpreadsheet(rows, "2026-10-20");

  it("名前は 家計簿_日付、取引と月次集計の2シートで見出しを固定", () => {
    expect(body.properties.title).toBe("家計簿_2026-10-20");
    expect(body.sheets.map((s) => s.properties.title)).toEqual(["取引", "月次集計"]);
    expect(body.sheets.every((s) => s.properties.gridProperties.frozenRowCount === 1)).toBe(true);
  });

  it("取引は日付の古い順・金額は数値（絶対値）", () => {
    const tx = values(body.sheets[0]);
    expect(tx[0]).toEqual([...TX_HEADER]);
    expect(tx.slice(1).map((r) => [r[0], r[1], r[2]])).toEqual([
      ["2026-09-03", "支出", 1200],
      ["2026-09-10", "支出", 80000],
      ["2026-09-11", "支出", 700],
      ["2026-09-25", "収入", 250000],
      ["2026-10-01", "支出", 300],
    ]);
  });

  it("月次集計は 月・収入・支出・差額＋カテゴリー列。無い月のカテゴリーは 0", () => {
    const m = values(body.sheets[1]);
    expect(m[0]).toEqual([...MONTHLY_FIXED_HEADER, "住居", "食費", UNCATEGORIZED]);
    expect(m.slice(1)).toEqual([
      ["2026-09", 250000, 81900, 168100, 80000, 1200, 700],
      ["2026-10", 0, 300, -300, 0, 300, 0],
    ]);
  });

  it("式に見えるメモも文字列のまま（stringValue は式として動かない）", () => {
    const b = buildSpreadsheet([row({ note: "=HYPERLINK(\"x\")" })], "2026-10-20");
    expect(b.sheets[0].data[0].rowData[1].values[4]).toEqual({ userEnteredValue: { stringValue: "=HYPERLINK(\"x\")" } });
  });
});
