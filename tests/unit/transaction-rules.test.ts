/**
 * @file tests/unit/transaction-rules.test.ts
 * @description テスト一覧 B（取引）のうち、DB を使わない入力ルールと日付計算の単体テスト。
 * - T1 金額は「1円以上の整数円」だけ
 * - T2 日付は実在する YYYY-MM-DD だけ（未来日は可）
 * - T3 月の境界は日本時間（JST）で決める
 */

import { describe, expect, it } from "vitest";
import { parseDateOnly, parseYenAmount } from "@/lib/validation/transaction";
import { dateOnlyToDb, monthRange, toJstDateString } from "@/lib/date/jst";

describe("T1 金額は整数円（1円以上）", () => {
  it.each([1, 1000, 9_999_999_999])("%s 円は受け付ける", (v) => {
    expect(parseYenAmount(v)).toEqual({ ok: true, value: v });
  });

  it.each([
    ["小数", 1.5],
    ["小数（端数0.01）", 100.01],
    ["負数", -100],
    ["0", 0],
    ["文字列", "1000"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["桁あふれ（100億円）", 10_000_000_000],
    ["null", null],
    ["未指定", undefined],
  ])("%s は拒否", (_label, v) => {
    const r = parseYenAmount(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/円/);
  });
});

describe("T2 日付は実在する YYYY-MM-DD だけ", () => {
  it.each(["2026-10-08", "2028-02-29", "2099-12-31", "2000-01-01"])("%s は受け付ける（未来日も可）", (s) => {
    expect(parseDateOnly(s)).toEqual({ ok: true, value: s });
  });

  it.each(["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "abc", "2026/10/01", "2026-1-1", "", "2026-10-08T00:00:00Z", "1899-12-31"])(
    "%s は拒否",
    (s) => {
      expect(parseDateOnly(s).ok).toBe(false);
    }
  );

  it("文字列でなければ拒否", () => {
    expect(parseDateOnly(20261008).ok).toBe(false);
    expect(parseDateOnly(null).ok).toBe(false);
  });
});

describe("T3 日付と月の境界は JST", () => {
  it("JST の月末 23:59 は当月、月初 0:00 は翌月", () => {
    // 2026-10-31 23:59 JST = 2026-10-31 14:59 UTC
    expect(toJstDateString(new Date("2026-10-31T14:59:59Z"))).toBe("2026-10-31");
    // 2026-11-01 00:00 JST = 2026-10-31 15:00 UTC（UTC ではまだ10月）
    expect(toJstDateString(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    // 年またぎ
    expect(toJstDateString(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });

  it("monthRange は [当月1日, 翌月1日) を日付だけで返す（サーバーの TZ に依存しない）", () => {
    const r = monthRange(2026, 10);
    expect(r.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(r.lt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const dec = monthRange(2026, 12);
    expect(dec.lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("monthRange は不正な年月を拒否", () => {
    expect(() => monthRange(2026, 13)).toThrow();
    expect(() => monthRange(2026, 0)).toThrow();
    expect(() => monthRange(Number.NaN, 1)).toThrow();
  });

  it("dateOnlyToDb は YYYY-MM-DD を UTC 0時の Date にする（DB の date 列にそのまま入る）", () => {
    expect(dateOnlyToDb("2026-10-31").toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });

  it("このテストは Asia/Tokyo で動いている（TZ 依存バグを炙り出すための前提）", () => {
    expect(new Date("2026-10-01T00:00:00Z").getTimezoneOffset()).toBe(-540);
  });
});
