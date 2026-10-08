/**
 * @file tests/unit/fixed-cost-schedule.test.ts
 * @description テスト一覧 C（定期支出）のうち、DB を使わない日付計算・入力ルールの単体テスト。
 * - R2 周期（毎週・隔週・毎月・毎年）ごとの支払日と次回日付
 * - R3 31日指定の月末丸め（うるう年を含む）
 * - R4 収入の定期も入力として受け付ける
 * - R7 開始日・終了日で範囲が切れる
 * - R9 月あたりの金額（月の固定費合計の材料）
 * 日付はすべて "YYYY-MM-DD" の文字列で扱う（サーバーの TZ に左右されないように）。
 */

import { describe, expect, it } from "vitest";
import {
  addDays,
  monthlyEquivalent,
  nextOccurrence,
  occurrencesBetween,
  type ScheduleRule,
} from "@/lib/fixed-costs/schedule";
import { parseFixedCostInput } from "@/lib/validation/fixed-cost";
import { todayJst } from "@/lib/date/jst";

const rule = (r: Partial<ScheduleRule>): ScheduleRule => ({
  cycle: "monthly",
  billingDay: 1,
  billingMonth: null,
  startDate: "2026-01-01",
  endDate: null,
  ...r,
});

describe("R2 周期ごとの支払日", () => {
  it("毎月: billing_day の日に毎月", () => {
    const r = rule({ cycle: "monthly", billingDay: 25, startDate: "2026-10-08" });
    expect(occurrencesBetween(r, "2026-10-01", "2026-12-31")).toEqual(["2026-10-25", "2026-11-25", "2026-12-25"]);
  });

  it("毎週: 開始日から7日ごと", () => {
    const r = rule({ cycle: "weekly", billingDay: null, startDate: "2026-10-08" });
    expect(occurrencesBetween(r, "2026-10-01", "2026-10-31")).toEqual([
      "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29",
    ]);
  });

  it("隔週: 開始日から14日ごと（範囲の途中からでも開始日基準で数える）", () => {
    const r = rule({ cycle: "biweekly", billingDay: null, startDate: "2026-10-08" });
    expect(occurrencesBetween(r, "2026-10-09", "2026-11-30")).toEqual(["2026-10-22", "2026-11-05", "2026-11-19"]);
  });

  it("毎年: billing_month の billing_day に毎年", () => {
    const r = rule({ cycle: "yearly", billingDay: 15, billingMonth: 3, startDate: "2026-01-01" });
    expect(occurrencesBetween(r, "2026-01-01", "2028-12-31")).toEqual(["2026-03-15", "2027-03-15", "2028-03-15"]);
  });

  it("次回日付: 当日を含み、月・年をまたいで正しく進む", () => {
    const m = rule({ cycle: "monthly", billingDay: 25, startDate: "2026-01-01" });
    expect(nextOccurrence(m, "2026-10-25")).toBe("2026-10-25");
    expect(nextOccurrence(m, "2026-10-26")).toBe("2026-11-25");
    expect(nextOccurrence(m, "2026-12-26")).toBe("2027-01-25");
    const w = rule({ cycle: "weekly", billingDay: null, startDate: "2026-10-08" });
    expect(nextOccurrence(w, "2026-10-09")).toBe("2026-10-15");
    const y = rule({ cycle: "yearly", billingDay: 1, billingMonth: 4, startDate: "2026-01-01" });
    expect(nextOccurrence(y, "2026-04-02")).toBe("2027-04-01");
  });

  it("開始日より前を聞かれたら最初の支払日を返す", () => {
    const w = rule({ cycle: "biweekly", billingDay: null, startDate: "2026-12-01" });
    expect(nextOccurrence(w, "2026-10-01")).toBe("2026-12-01");
  });
});

describe("R3 月末の丸め", () => {
  const m31 = rule({ cycle: "monthly", billingDay: 31, startDate: "2026-01-01" });

  it("31日指定は 30日の月で30日、2月で28日", () => {
    expect(occurrencesBetween(m31, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
    ]);
  });

  it("うるう年の2月は29日", () => {
    expect(occurrencesBetween(m31, "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });

  it("30日指定は2月だけ丸め、3月は30日に戻る", () => {
    const m30 = rule({ cycle: "monthly", billingDay: 30, startDate: "2026-01-01" });
    expect(occurrencesBetween(m30, "2026-02-01", "2026-03-31")).toEqual(["2026-02-28", "2026-03-30"]);
  });

  it("毎年 2/29 指定は平年 2/28、うるう年 2/29", () => {
    const y = rule({ cycle: "yearly", billingDay: 29, billingMonth: 2, startDate: "2026-01-01" });
    expect(occurrencesBetween(y, "2026-01-01", "2028-12-31")).toEqual(["2026-02-28", "2027-02-28", "2028-02-29"]);
  });
});

describe("R7 開始日・終了日", () => {
  const r = rule({ cycle: "monthly", billingDay: 10, startDate: "2026-11-01", endDate: "2027-01-31" });

  it("開始日より前・終了日より後は作らない", () => {
    expect(occurrencesBetween(r, "2026-10-01", "2027-12-31")).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
  });

  it("終了日を過ぎたら次回日付は無い", () => {
    expect(nextOccurrence(r, "2027-01-11")).toBeNull();
  });

  it("毎週の終了日は当日を含む", () => {
    const w = rule({ cycle: "weekly", billingDay: null, startDate: "2026-10-01", endDate: "2026-10-15" });
    expect(occurrencesBetween(w, "2026-10-01", "2026-12-31")).toEqual(["2026-10-01", "2026-10-08", "2026-10-15"]);
  });
});

describe("R9 月あたりの金額", () => {
  it.each([
    ["monthly", 1000, 1000],
    ["yearly", 12000, 1000],
    ["weekly", 1000, 4333], // 1000 × 52 ÷ 12
    ["biweekly", 1000, 2167], // 1000 × 26 ÷ 12
  ] as const)("%s %d 円 → 月 %d 円", (cycle, amount, expected) => {
    expect(monthlyEquivalent(amount, cycle)).toBe(expected);
  });
});

describe("日付の道具", () => {
  it("addDays は月・年・うるう日をまたぐ", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("todayJst は日本時間の日付（UTC 15:00 = 翌日 0:00）", () => {
    expect(todayJst(new Date("2026-10-08T14:59:59Z"))).toBe("2026-10-08");
    expect(todayJst(new Date("2026-10-08T15:00:00Z"))).toBe("2026-10-09");
  });
});

describe("定期支出の入力ルール（R1・R2・R4・R7）", () => {
  const base = { account_id: "a", name: "家賃", amount: 80000, billing_day: 27 };

  it("既定は 支出・毎月", () => {
    const r = parseFixedCostInput(base, "create", "2026-10-08");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ type: "expense", cycle: "monthly", billingDay: 27, startDate: "2026-10-08" });
    }
  });

  it("R4 収入の定期を受け付ける", () => {
    const r = parseFixedCostInput({ ...base, name: "給料", type: "income", amount: 250000 }, "create", "2026-10-08");
    expect(r.ok && r.value.type).toBe("income");
  });

  it("毎週・隔週は billing_day 不要（開始日の曜日で決まる）", () => {
    const r = parseFixedCostInput(
      { account_id: "a", name: "ジム", amount: 1000, cycle: "weekly", start_date: "2026-10-08" },
      "create",
      "2026-10-08"
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ cycle: "weekly", billingDay: null });
  });

  it.each([
    ["周期が不正", { ...base, cycle: "daily" }],
    ["種別が不正", { ...base, type: "transfer" }],
    ["毎年なのに billing_month が無い", { ...base, cycle: "yearly" }],
    ["billing_month が 13", { ...base, cycle: "yearly", billing_month: 13 }],
    ["毎月なのに billing_day が無い", { account_id: "a", name: "x", amount: 100 }],
    ["billing_day が 32", { ...base, billing_day: 32 }],
    ["終了日が開始日より前", { ...base, start_date: "2026-10-08", end_date: "2026-10-01" }],
    ["開始日が実在しない", { ...base, start_date: "2026-02-30" }],
    ["金額が小数", { ...base, amount: 10.5 }],
    ["名前が空", { ...base, name: "  " }],
  ])("%s は拒否", (_label, body) => {
    const r = parseFixedCostInput(body, "create", "2026-10-08");
    expect(r.ok).toBe(false);
  });

  it("更新では送られた項目だけ返す", () => {
    const r = parseFixedCostInput({ amount: 2000 }, "update", "2026-10-08");
    expect(r).toEqual({ ok: true, value: { amount: 2000 } });
  });
});
