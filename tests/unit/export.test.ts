/**
 * @file tests/unit/export.test.ts
 * @description テスト一覧 X1（家計簿アプリ形式 CSV の書き出し）と、完全形式 JSON の検査（X3 の入口）の単体テスト。
 * DB を使わない純粋関数だけを見る（lib/export/kakebo-csv.ts・lib/export/full-json.ts の parseBackup）。
 * DB を通した書き出し・復元・全削除・取り込みの取り消しは tests/api/export-api.test.ts。
 */

import { describe, expect, it } from "vitest";
import { KAKEBO_CSV_BOM, backupFilename, toKakeboCsv, type CsvExportRow } from "@/lib/export/kakebo-csv";
import { FULL_FORMAT, FULL_VERSION, parseBackup, emptyBackupData } from "@/lib/export/full-json";
import { decodeCsv } from "@/lib/csv/decode";
import { detectFormat, parseKakebo } from "@/lib/csv/kakebo";

const row = (o: Partial<CsvExportRow>): CsvExportRow => ({
  date: "2026-09-03",
  amount: 500,
  type: "expense",
  note: null,
  categoryName: null,
  ...o,
});

describe("X1 家計簿アプリ形式 CSV", () => {
  it("BOM 付き UTF-8・ヘッダーは 金額,日付,メモ,カテゴリー名・支出は負・収入は正・日付は YYYY/MM/DD", () => {
    const csv = toKakeboCsv([
      row({ amount: 500, type: "expense", note: "パン", categoryName: "食費" }),
      row({ date: "2026-09-30", amount: 30000, type: "income", categoryName: "給料" }),
    ]);
    expect(csv.startsWith(KAKEBO_CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("金額,日付,メモ,カテゴリー名");
    expect(lines[1]).toBe("-500,2026/09/03,パン,食費");
    expect(lines[2]).toBe("30000,2026/09/30,,給料");
  });

  it("日付の古い順に並ぶ（同じ日は渡した順）。予定（今日より後）の行も入る", () => {
    const csv = toKakeboCsv([
      row({ date: "2099-12-25", note: "予定の家賃" }),
      row({ date: "2026-01-02", note: "b" }),
      row({ date: "2026-01-01", note: "a" }),
      row({ date: "2026-01-02", note: "c" }),
    ]);
    const notes = csv.slice(1).trim().split("\r\n").slice(1).map((l) => l.split(",")[2]);
    expect(notes).toEqual(["a", "b", "c", "予定の家賃"]);
  });

  it("カンマ・改行・引用符を含むメモは CSV の規則どおりに囲む", () => {
    const csv = toKakeboCsv([row({ note: 'A, "B"\nC', categoryName: "食費" })]);
    expect(csv).toContain('"A, ""B""\nC"');
  });

  it("表計算ソフトで式として動く先頭（= + @ と数字でない -）には ' を付ける（CSV インジェクション対策）", () => {
    const csv = toKakeboCsv([
      row({ note: "=HYPERLINK(1)" }),
      row({ note: "+1" }),
      row({ note: "@SUM(1)" }),
      row({ note: "-abc" }),
      row({ note: "-100" }),
    ]);
    const notes = parseKakebo(decodeCsv(new TextEncoder().encode(csv))).rows.map((r) => r.note);
    expect(notes).toEqual(["'=HYPERLINK(1)", "'+1", "'@SUM(1)", "'-abc", "-100"]);
  });

  it("lib/csv/kakebo.ts で読み戻すと、同じ日付・金額・向き・メモ・カテゴリーになる", () => {
    const input = [
      row({ date: "2026-09-03", amount: 500, type: "expense", note: "パン", categoryName: "食費" }),
      row({ date: "2026-09-30", amount: 30000, type: "income", note: null, categoryName: "給料" }),
      row({ date: "2099-12-25", amount: 80000, type: "expense", note: "家賃", categoryName: null }),
    ];
    const text = decodeCsv(new TextEncoder().encode(toKakeboCsv(input)));
    expect(detectFormat(text)).toBe("kakebo");
    const { rows, invalid } = parseKakebo(text);
    expect(invalid).toEqual([]);
    expect(rows.map((r) => [r.date, r.amount, r.type, r.note, r.categoryName])).toEqual([
      ["2026-09-03", 500, "expense", "パン", "食費"],
      ["2026-09-30", 30000, "income", "", "給料"],
      ["2099-12-25", 80000, "expense", "家賃", ""],
    ]);
  });

  it("行が無くてもヘッダーだけの CSV になる", () => {
    expect(toKakeboCsv([])).toBe(`${KAKEBO_CSV_BOM}金額,日付,メモ,カテゴリー名\r\n`);
  });

  it("ファイル名は英数字だけ（日本語のファイル名で落ちる端末があるため）", () => {
    expect(backupFilename("kakebo-csv", "2026-10-16")).toBe("kakebo_2026-10-16.csv");
    expect(backupFilename("full-json", "2026-10-16")).toBe("kakebo-full_2026-10-16.json");
  });
});

describe("完全形式 JSON の検査（parseBackup）", () => {
  const valid = () => ({
    format: FULL_FORMAT,
    version: FULL_VERSION,
    exported_at: "2026-10-16T09:00:00.000Z",
    definitions_version: "2026-10-14.1",
    data: emptyBackupData(),
  });

  it("正しい形なら ok", () => {
    const r = parseBackup(valid());
    expect(r.ok).toBe(true);
  });

  it("形式名・版が違えば理由付きで拒む（他のアプリの JSON・未来の版を入れない）", () => {
    expect(parseBackup({ ...valid(), format: "other" })).toMatchObject({ ok: false });
    expect(parseBackup({ ...valid(), version: 2 })).toMatchObject({ ok: false });
    expect(parseBackup(null)).toMatchObject({ ok: false });
    expect(parseBackup([])).toMatchObject({ ok: false });
  });

  it("取引の金額・日付・種類が不正なら拒む", () => {
    const b = valid();
    const tx = {
      id: "11111111-1111-4111-8111-111111111111",
      account_id: "22222222-2222-4222-8222-222222222222",
      category_id: null,
      fixed_cost_id: null,
      amount: 500,
      type: "expense",
      kind: "normal",
      transaction_date: "2026-09-03",
      note: null,
      source: "manual",
      csv_import_id: null,
      import_key: null,
      deleted_at: null,
      created_at: "2026-09-03T00:00:00.000Z",
      updated_at: "2026-09-03T00:00:00.000Z",
    };
    expect(parseBackup({ ...b, data: { ...b.data, transactions: [tx] } }).ok).toBe(true);
    expect(parseBackup({ ...b, data: { ...b.data, transactions: [{ ...tx, kind: "gift" }] } }).ok).toBe(false);
    expect(parseBackup({ ...b, data: { ...b.data, transactions: [{ ...tx, transaction_date: "2026-02-30" }] } }).ok).toBe(false);
    expect(parseBackup({ ...b, data: { ...b.data, transactions: [{ ...tx, amount: "500" }] } }).ok).toBe(false);
    expect(parseBackup({ ...b, data: { ...b.data, transactions: [{ ...tx, id: "x" }] } }).ok).toBe(false);
  });

  it("拒む理由に中身（金額・メモ）を入れない", () => {
    const b = valid();
    const r = parseBackup({ ...b, data: { ...b.data, transactions: [{ note: "秘密のメモ", amount: 123456 }] } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).not.toContain("秘密のメモ");
      expect(r.reason).not.toContain("123456");
    }
  });
});
