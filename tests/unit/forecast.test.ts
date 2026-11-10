/**
 * @file tests/unit/forecast.test.ts
 * @description 今月の収支の見込み込み（app#43）。受け入れ条件ごとに確かめる。数字はすべて作った値。
 *   AC1 定期収入が入金日前でも当月の収入に入る
 *   AC2 定期支出が出金日前でも当月の支出に入る
 *   AC3 月末の定期も月初から入る
 *   AC4 ホームの月間収支（ウィジェット API・ダッシュボードの API）に出る → widget-summary.test.ts と下の loadMonthlySummary
 *   AC5 実績が記録された後に二重に数えない（自動の取引・条件に当てはまる手入力）
 *   AC6 定期が無ければ従来どおり
 *   ＋ 過去月・翌月に影響しない、ドル建ては円に直す
 */

import { describe, expect, it, vi } from "vitest";
import { forecastMonth } from "@/lib/aggregate/forecast";
import { summarize, type AggTx } from "@/lib/aggregate/monthly";
import { upcomingInMonth, type UpcomingSource } from "@/lib/fixed/upcoming";
import { loadMonthlySummary } from "@/lib/aggregate/load";
import type { UserDb } from "@/lib/db";

let seq = 0;
const tx = (over: Partial<AggTx> = {}): AggTx => ({
  id: `t${++seq}`,
  date: "2026-11-05",
  amount: 1000,
  type: "expense",
  kind: "normal",
  categoryId: "C:食費",
  categoryName: "食費",
  categoryType: "expense",
  note: null,
  source: "manual",
  fixedCostId: null,
  ...over,
});

const salary: UpcomingSource = {
  id: "fc-salary",
  name: "給料",
  type: "income",
  categoryId: "C:給料",
  amount: 200000,
  matchNote: null,
  matchAnyAmount: false,
  cycle: "monthly",
  billingDay: 25,
  billingMonth: null,
  startDate: "2026-01-01",
  endDate: null,
  isActive: true,
  generatedThrough: "2026-11-09",
};
const rent: UpcomingSource = { ...salary, id: "fc-rent", name: "家賃", type: "expense", categoryId: "C:家賃", amount: 60000, billingDay: 31 };

/** 画面と同じ流れ（summarize → upcomingInMonth → forecastMonth）で月の数字を出す */
function run(txs: AggTx[], sources: UpcomingSource[], month: string, today: string) {
  const summary = summarize({ txs, month, today, fixedConditions: sources });
  const upcoming = upcomingInMonth({ sources, txs, month, today });
  return { summary, forecast: forecastMonth({ summary, upcoming, txs }) };
}

const food = tx({ amount: 30000 }); // 今月の実績の支出（11/5）

describe("AC1・AC2 定期は支払日前でも今月の収入・支出に入る", () => {
  it("11/10 時点で、25日の給料と月末の家賃を見込みに足す", () => {
    const { summary, forecast } = run([food], [salary, rent], "2026-11", "2026-11-10");
    // 実績は今までどおり
    expect(summary.income.total).toBe(0);
    expect(summary.expense.total).toBe(30000);
    expect(summary.balance).toBe(-30000);
    // 見込み込み
    expect(forecast.applies).toBe(true);
    expect(forecast.income).toBe(200000);
    expect(forecast.expense).toBe(90000);
    expect(forecast.balance).toBe(110000);
    expect(forecast.forecastIncome).toBe(200000);
    expect(forecast.forecastExpense).toBe(60000);
    expect(forecast.items.map((i) => `${i.name}:${i.date}`)).toEqual(["給料:2026-11-25", "家賃:2026-11-30"]);
  });
});

describe("AC3 月末の定期も月初から入る", () => {
  it("11/1 に、月末（31日→30日）の家賃が入っている", () => {
    const { forecast } = run([], [{ ...rent, generatedThrough: "2026-10-31" }], "2026-11", "2026-11-01");
    expect(forecast.applies).toBe(true);
    expect(forecast.expense).toBe(60000);
    expect(forecast.items[0].date).toBe("2026-11-30");
  });
});

describe("AC5 実績が記録された後に二重に数えない", () => {
  it("給料日に定期の展開が取引を作り印を進めたら、見込みから外れて実績に切り替わる（合計は同じ）", () => {
    const before = run([food], [salary], "2026-11", "2026-11-24").forecast;
    const auto = tx({ date: "2026-11-25", amount: 200000, type: "income", categoryId: "C:給料", source: "auto", fixedCostId: "fc-salary", note: "給料" });
    const { summary, forecast } = run([food, auto], [{ ...salary, generatedThrough: "2026-11-25" }], "2026-11", "2026-11-25");
    expect(summary.income.total).toBe(200000); // 実績に入った
    expect(forecast.applies).toBe(false); // 見込みはもう無い
    expect(forecast.income).toBe(200000); // 二重の 400000 にならない
    expect(forecast.balance).toBe(before.balance);
  });

  it("自動の取引はできたが印がまだ進んでいない（展開の途中で落ちた等）ときも、同じ定期・同じ日なら外す", () => {
    const auto = tx({ date: "2026-11-25", amount: 200000, type: "income", categoryId: "C:給料", source: "auto", fixedCostId: "fc-salary", note: "給料" });
    const { forecast } = run([auto], [{ ...salary, generatedThrough: "2026-11-24" }], "2026-11", "2026-11-25");
    expect(forecast.income).toBe(200000);
    expect(forecast.forecastIncome).toBe(0);
  });

  it("定期の条件（カテゴリー・金額）に当てはまる手入力が先にあれば、見込みに足さない（展開も作らない: F7）", () => {
    const manual = tx({ date: "2026-11-08", amount: 60000, categoryId: "C:家賃", note: "家賃 振込" });
    const { summary, forecast } = run([manual], [rent], "2026-11", "2026-11-10");
    expect(summary.expense.total).toBe(60000);
    expect(forecast.applies).toBe(false);
    expect(forecast.expense).toBe(60000);
  });

  it("金額が違う手入力は別の取引として数える（条件に当てはまらない＝展開も別に作る）", () => {
    const manual = tx({ date: "2026-11-08", amount: 59000, categoryId: "C:家賃" });
    const { forecast } = run([manual], [rent], "2026-11", "2026-11-10");
    expect(forecast.expense).toBe(119000);
  });
});

describe("AC6 定期が無ければ従来どおり", () => {
  it("定期が無い月は applies=false で、数字は実績と同じ", () => {
    const { summary, forecast } = run([food], [], "2026-11", "2026-11-10");
    expect(forecast).toEqual({
      applies: false,
      income: summary.income.total,
      expense: summary.expense.total,
      balance: summary.balance,
      forecastIncome: 0,
      forecastExpense: 0,
      items: [],
    });
  });

  it("一時停止中の定期だけなら従来どおり", () => {
    expect(run([food], [{ ...salary, isActive: false }], "2026-11", "2026-11-10").forecast.applies).toBe(false);
  });
});

describe("過去月・翌月に影響しない", () => {
  it("先月は実績のまま（見込みを足さない）", () => {
    const { summary, forecast } = run([tx({ date: "2026-10-05" })], [salary, rent], "2026-10", "2026-11-10");
    expect(forecast.applies).toBe(false);
    expect(forecast.expense).toBe(summary.expense.total);
  });

  it("翌月は予定（upcoming）には出るが、見込みとして数字には足さない", () => {
    const { forecast } = run([], [salary, rent], "2026-12", "2026-11-10");
    expect(forecast.applies).toBe(false);
    expect(forecast.income).toBe(0);
    expect(forecast.expense).toBe(0);
  });

  it("今月の見込みに翌月の回は入らない（毎週の定期でも月末まで）", () => {
    const weekly: UpcomingSource = { ...rent, id: "fc-weekly", name: "週の積立", amount: 1000, cycle: "weekly", billingDay: null, startDate: "2026-11-02" };
    const { forecast } = run([], [weekly], "2026-11", "2026-11-25");
    // 11/2 から毎週: 今日以降の今月の回は 11/30 だけ（12/7 は入らない）
    expect(forecast.items.map((i) => i.date)).toEqual(["2026-11-30"]);
    expect(forecast.expense).toBe(1000);
  });
});

/** loadMonthlySummary に渡す作り物の DB（必要な3つの読み取りだけ） */
function fakeDb(fixedCosts: Record<string, unknown>[], rows: Record<string, unknown>[] = []): UserDb {
  return {
    transaction: { findMany: vi.fn(async () => rows) },
    fixedCost: { findMany: vi.fn(async () => fixedCosts) },
    category: { findMany: vi.fn(async () => []) },
  } as unknown as UserDb;
}
const fcRow = (over: Record<string, unknown> = {}) => ({
  id: "fc-sub",
  userId: "u1",
  accountId: "a1",
  categoryId: "C:サブスク",
  name: "クラウド",
  amount: 20,
  type: "expense",
  cycle: "monthly",
  billingDay: 28,
  billingMonth: null,
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: null,
  generatedThrough: new Date("2026-11-09T00:00:00Z"),
  isActive: true,
  matchNote: null,
  matchAnyAmount: false,
  currency: "JPY",
  ...over,
});

describe("AC4 API が使う loadMonthlySummary に見込みが入る", () => {
  it("円の定期はそのまま、相場は取りに行かない", async () => {
    const rate = vi.fn(async () => 150);
    const data = await loadMonthlySummary(fakeDb([fcRow({ amount: 1500 })]), "u1", "2026-11", { today: "2026-11-10", owner: false, rate });
    expect(data.forecast.expense).toBe(1500);
    expect(rate).not.toHaveBeenCalled();
  });

  it("ドル建ての定期は直近のドル円で円に直して見込む（$20×150円＝3000円）", async () => {
    const rate = vi.fn(async () => 150);
    const data = await loadMonthlySummary(fakeDb([fcRow({ currency: "USD" })]), "u1", "2026-11", { today: "2026-11-10", owner: false, rate });
    expect(rate).toHaveBeenCalledWith("latest");
    expect(data.upcoming[0].amount).toBe(3000);
    expect(data.forecast.expense).toBe(3000);
  });

  it("ドル円が取れなければ、ドル建ての回は見込みに入れない（ドルの数字を円として足さない）", async () => {
    const data = await loadMonthlySummary(fakeDb([fcRow({ currency: "USD" })]), "u1", "2026-11", { today: "2026-11-10", owner: false, rate: async () => null });
    expect(data.upcoming).toEqual([]);
    expect(data.forecast.applies).toBe(false);
  });

  it("DB の自動の取引の定期 ID を読んで、同じ日の回を外す", async () => {
    const auto = {
      id: "t-auto",
      transactionDate: new Date("2026-11-28T00:00:00Z"),
      amount: 1500,
      type: "expense",
      kind: "normal",
      categoryId: "C:サブスク",
      note: "クラウド",
      source: "auto",
      fixedCostId: "fc-sub",
      category: null,
    };
    // 今日は 11/28。印は 11/27 のまま（展開の途中で落ちた想定）
    const data = await loadMonthlySummary(fakeDb([fcRow({ amount: 1500, generatedThrough: new Date("2026-11-27T00:00:00Z") })], [auto]), "u1", "2026-11", {
      today: "2026-11-28",
      owner: false,
    });
    expect(data.txs[0].fixedCostId).toBe("fc-sub");
    expect(data.upcoming).toHaveLength(1); // 予定の一覧には残る（今までどおり）
    expect(data.forecast.applies).toBe(false); // 見込みには足さない
    expect(data.forecast.expense).toBe(1500);
  });
});
