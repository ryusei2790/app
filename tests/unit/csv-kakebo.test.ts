/**
 * @file tests/unit/csv-kakebo.test.ts
 * @description テスト一覧 I（買い切り家計簿アプリの CSV 取り込み）のうち、DB を使わない部分。
 * - I1 ヘッダーで形式を判定（BOM 付き・無し・CRLF）
 * - I2 金額の符号で支出／収入を決める
 * - I3 読めない行は行番号と理由付きで除外し、他の行は読む
 * - I5 の前提: 同じ内容の行が2つあれば目印が別になる
 * - I11 Shift_JIS の CSV も読める
 * データは作り物だけ（実データから作らない）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeCsv } from "@/lib/csv/decode";
import { detectFormat, parseKakebo } from "@/lib/csv/kakebo";
import { withImportKeys } from "@/lib/csv/import-key";

const HEADER = "金額,日付,メモ,カテゴリー名";
const dummy = readFileSync(path.resolve(__dirname, "../fixtures/csv/kakebo_dummy.csv"));
const utf8 = (s: string) => new TextEncoder().encode(s);

describe("I1 家計簿アプリ形式をヘッダーで判定する", () => {
  it("BOM 無し・LF", () => {
    expect(detectFormat(decodeCsv(utf8(`${HEADER}\n-100,2026/09/01,,食費\n`)))).toBe("kakebo");
  });

  it("BOM 付き・CRLF", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(`${HEADER}\r\n-100,2026/09/01,,食費\r\n`)]);
    const text = decodeCsv(bytes);
    expect(text.charCodeAt(0)).not.toBe(0xfeff); // BOM は取り除く
    expect(detectFormat(text)).toBe("kakebo");
    expect(parseKakebo(text).rows).toHaveLength(1);
  });

  it("違うヘッダーは家計簿アプリ形式にしない", () => {
    expect(detectFormat("ご利用日,ご利用先など,ご利用金額(円)\n")).toBeNull();
  });

  it("作り物の CSV（fixtures）を読める", () => {
    const { rows, invalid } = parseKakebo(decodeCsv(dummy));
    expect(invalid).toEqual([]);
    expect(rows).toHaveLength(8);
  });
});

describe("I2 金額の符号で支出・収入を決める", () => {
  it("負は支出・正は収入、金額は絶対値の整数円、日付は YYYY-MM-DD", () => {
    const { rows } = parseKakebo(`${HEADER}\n-1234,2026/09/01,パン,食費\n30000,2026/09/30,,給料\n`);
    expect(rows[0]).toMatchObject({ line: 2, date: "2026-09-01", amount: 1234, type: "expense", note: "パン", categoryName: "食費" });
    expect(rows[1]).toMatchObject({ line: 3, date: "2026-09-30", amount: 30000, type: "income", note: "", categoryName: "給料" });
  });

  it("メモ・カテゴリーの前後の空白は取る", () => {
    const { rows } = parseKakebo(`${HEADER}\n-100,2026/09/01, パン , 食費 \n`);
    expect(rows[0]).toMatchObject({ note: "パン", categoryName: "食費" });
  });
});

describe("I3 読めない行は理由付きで除外し、他の行は読む", () => {
  const text = [
    HEADER,
    "-100,2026/09/01,,食費", // 2 OK
    "0,2026/09/01,,食費", // 3 0円
    "-100.5,2026/09/01,,食費", // 4 小数
    "abc,2026/09/01,,食費", // 5 数字でない
    "-100,2026/02/30,,食費", // 6 実在しない日
    "-100,2026-9-1,,食費", // 7 形が違う
    "", // 8 空行は数えない
    "-200,2026/09/02,,食費", // 9 OK
  ].join("\n");

  it("正しい行だけ rows に入る", () => {
    const { rows } = parseKakebo(text);
    expect(rows.map((r) => r.line)).toEqual([2, 9]);
  });

  it("読めない行は行番号と理由が出る（空行は出さない）", () => {
    const { invalid } = parseKakebo(text);
    expect(invalid.map((e) => e.line)).toEqual([3, 4, 5, 6, 7]);
    for (const e of invalid) expect(e.reason.length).toBeGreaterThan(0);
  });

  it("理由に金額やメモの中身は書かない（画面とログに出しても困らない）", () => {
    const { invalid } = parseKakebo(`${HEADER}\n-100.5,2026/09/01,秘密のメモ,食費\n`);
    expect(invalid[0].reason).not.toContain("秘密のメモ");
    expect(invalid[0].reason).not.toContain("100.5");
  });
});

describe("行の目印（重複を見分ける）", () => {
  it("同じ内容の行が2つあれば、目印は別（1個目・2個目）", () => {
    const { rows } = parseKakebo(`${HEADER}\n-500,2026/09/03,パン,食費\n-500,2026/09/03,パン,食費\n`);
    const keyed = withImportKeys(rows);
    expect(keyed[0].importKey).not.toBe(keyed[1].importKey);
  });

  it("同じ行は、どのファイルにあっても同じ目印（並び順・他の行に左右されない）", () => {
    const a = withImportKeys(parseKakebo(`${HEADER}\n-500,2026/09/03,パン,食費\n-1,2026/01/01,,食費\n`).rows);
    const b = withImportKeys(parseKakebo(`${HEADER}\n-9,2026/10/01,,食費\n-500,2026/09/03,パン,食費\n`).rows);
    expect(a[0].importKey).toBe(b[1].importKey);
  });

  it("金額・日付・メモ・カテゴリー・支出/収入のどれかが違えば別の目印", () => {
    const base = "-500,2026/09/03,パン,食費";
    const variants = ["-501,2026/09/03,パン,食費", "-500,2026/09/04,パン,食費", "-500,2026/09/03,パン2,食費", "-500,2026/09/03,パン,外食費", "500,2026/09/03,パン,食費"];
    const keys = withImportKeys(parseKakebo([HEADER, base, ...variants].join("\n")).rows).map((r) => r.importKey);
    expect(new Set(keys).size).toBe(6);
  });

  it("目印には版が付き、中身（メモ・金額）がそのまま入らない", () => {
    const [r] = withImportKeys(parseKakebo(`${HEADER}\n-500,2026/09/03,パン,食費\n`).rows);
    expect(r.importKey).toMatch(/^v1:[0-9a-f]{64}$/);
  });
});

describe("I11 Shift_JIS の CSV も読める", () => {
  it("UTF-8 として読めなければ Shift_JIS で読む", () => {
    // 「金額,日付,メモ,カテゴリー名\n-100,2026/09/01,パン,食費\n」を Shift_JIS にしたバイト列
    const sjis = new Uint8Array([
      0x8b, 0xe0, 0x8a, 0x7a, 0x2c, 0x93, 0xfa, 0x95, 0x74, 0x2c, 0x83, 0x81, 0x83, 0x82, 0x2c,
      0x83, 0x4a, 0x83, 0x65, 0x83, 0x53, 0x83, 0x8a, 0x81, 0x5b, 0x96, 0xbc, 0x0a,
      0x2d, 0x31, 0x30, 0x30, 0x2c, 0x32, 0x30, 0x32, 0x36, 0x2f, 0x30, 0x39, 0x2f, 0x30, 0x31, 0x2c,
      0x83, 0x70, 0x83, 0x93, 0x2c, 0x90, 0x48, 0x94, 0xef, 0x0a,
    ]);
    const text = decodeCsv(sjis);
    expect(detectFormat(text)).toBe("kakebo");
    expect(parseKakebo(text).rows[0]).toMatchObject({ note: "パン", categoryName: "食費", amount: 100 });
  });
});
