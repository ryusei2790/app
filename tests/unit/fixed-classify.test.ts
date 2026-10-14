/**
 * @file tests/unit/fixed-classify.test.ts
 * @description テスト一覧 F（固定の収入・固定の支出の判定、mywork#229 設計メモ 2026-10-14）のうち DB を使わない部分。
 * - F1 定期から自動で作った取引（source='auto'）は無条件で固定
 * - F2 定期の条件（種別・カテゴリー・金額）に当てはまれば固定、外れれば変動
 * - F3 メモの語句は部分一致・大文字小文字を区別しない
 * - F4 「金額が毎回変わる」定期は金額を見ない
 * - F6 定期を削除すると過去の取引も変動に戻る（判定を取引に保存しない＝さかのぼる）。一時停止では戻らない
 * - F8 月の集計: 固定収入＋変動収入＝収入合計、固定支出＋変動支出＝支出合計
 * - 今月の予定: 定期のまだ取引になっていない回（今日以降・月末まで）。既に当てはまる取引がある月は出さない
 */

import { describe, expect, it } from "vitest";
import {
  classifyFixed,
  countMatches,
  hasMatchingInPeriod,
  summarizeFixed,
  type FixedCondition,
  type FixedTx,
} from "@/lib/fixed/classify";
import { upcomingInMonth, type UpcomingSource } from "@/lib/fixed/upcoming";

const cond = (over: Partial<FixedCondition> = {}): FixedCondition => ({
  id: "fc1",
  type: "income",
  categoryId: null,
  amount: 130000,
  matchNote: "仕送り",
  matchAnyAmount: false,
  ...over,
});

const tx = (over: Partial<FixedTx> = {}): FixedTx => ({
  date: "2026-09-27",
  amount: 130000,
  type: "income",
  categoryId: "C:その他",
  note: "仕送り",
  source: "csv",
  ...over,
});

describe("F1 定期から自動で作った取引は無条件で固定", () => {
  it("source='auto' なら条件が無くても固定（種別で収入／支出）", () => {
    expect(classifyFixed(tx({ source: "auto", note: "なんでも" }), [])).toBe("fixed");
    expect(classifyFixed(tx({ source: "auto", type: "expense", amount: 1 }), [])).toBe("fixed");
  });
});

describe("F2 条件に当てはまれば固定、外れれば変動", () => {
  it("種別・メモ・金額がそろえば固定", () => {
    expect(classifyFixed(tx(), [cond()])).toBe("fixed");
  });

  it("金額・種別・カテゴリーのどれかが違えば変動", () => {
    expect(classifyFixed(tx({ amount: 120000 }), [cond()])).toBe("variable");
    expect(classifyFixed(tx({ type: "expense" }), [cond()])).toBe("variable");
    expect(classifyFixed(tx(), [cond({ categoryId: "C:給料" })])).toBe("variable");
    expect(classifyFixed(tx(), [cond({ categoryId: "C:その他" })])).toBe("fixed");
  });

  it("メモの語句もカテゴリーも無い条件は、手入力・CSV の取引には当てはめない（金額だけの一致で固定にしない）", () => {
    expect(classifyFixed(tx(), [cond({ matchNote: null })])).toBe("variable");
    // カテゴリーがあれば、メモが無くてもカテゴリー＋金額で当てはまる（例: 家賃・給料）
    expect(classifyFixed(tx({ note: null, categoryId: "C:家賃" }), [cond({ matchNote: null, categoryId: "C:家賃" })])).toBe("fixed");
  });

  it("どれか1つの条件に当てはまれば固定", () => {
    const conds = [cond({ id: "a", matchNote: "給料", amount: 30000 }), cond({ id: "b" })];
    expect(classifyFixed(tx(), conds)).toBe("fixed");
  });
});

describe("F3 メモの語句は部分一致・大文字小文字を区別しない", () => {
  it("前後に他の語があっても・大文字小文字が違っても当てはまる", () => {
    const c = cond({ type: "expense", matchNote: "icloud", amount: 540 });
    expect(classifyFixed(tx({ type: "expense", amount: 540, note: "Apple iCloud+ 200GB" }), [c])).toBe("fixed");
    expect(classifyFixed(tx({ type: "expense", amount: 540, note: "Spotify" }), [c])).toBe("variable");
    expect(classifyFixed(tx({ type: "expense", amount: 540, note: null }), [c])).toBe("variable");
  });

  it("語句の前後の空白は無視する", () => {
    const c = cond({ matchNote: "  仕送り " });
    expect(classifyFixed(tx(), [c])).toBe("fixed");
  });
});

describe("F4 金額が毎回変わる定期は金額を見ない", () => {
  it("値上げ前の金額でも固定", () => {
    const c = cond({ type: "expense", matchNote: "iCloud", amount: 540, matchAnyAmount: true });
    expect(classifyFixed(tx({ type: "expense", amount: 450, note: "iCloud+" }), [c])).toBe("fixed");
  });

  it("金額を見ない定期でも、メモの語句もカテゴリーも無ければ当てはめない（何でも固定になるのを防ぐ）", () => {
    const c = cond({ matchNote: null, categoryId: null, matchAnyAmount: true });
    expect(classifyFixed(tx(), [c])).toBe("variable");
  });
});

describe("F6 判定は取引に保存しない（定期の一覧を直すと過去もさかのぼって変わる）", () => {
  it("同じ取引でも、条件の一覧から定期を外すと変動になる", () => {
    const t = tx({ date: "2026-04-27" });
    expect(classifyFixed(t, [cond()])).toBe("fixed");
    expect(classifyFixed(t, [])).toBe("variable");
  });
});

describe("F8 月の集計: 固定と変動の合計が収入合計・支出合計と一致", () => {
  const conds = [
    cond(),
    cond({ id: "rent", type: "expense", categoryId: "C:家賃", matchNote: null, amount: 59590 }),
  ];
  const txs: FixedTx[] = [
    tx(),
    tx({ date: "2026-09-30", amount: 30000, note: null, categoryId: "C:給料", source: "auto" }),
    tx({ date: "2026-09-10", amount: 5000, note: "お祝い", categoryId: "C:その他" }),
    tx({ date: "2026-09-27", type: "expense", amount: 59590, note: null, categoryId: "C:家賃" }),
    tx({ date: "2026-09-03", type: "expense", amount: 1200, note: null, categoryId: "C:食費" }),
    tx({ date: "2026-09-04", type: "expense", amount: 800, note: null, categoryId: "C:食費" }),
  ];

  it("収入・支出を固定／変動に分けて足す", () => {
    expect(summarizeFixed(txs, conds)).toEqual({
      fixedIncome: 160000,
      variableIncome: 5000,
      fixedExpense: 59590,
      variableExpense: 2000,
    });
  });

  it("どんな組でも 固定＋変動 ＝ 合計", () => {
    const s = summarizeFixed(txs, conds);
    const income = txs.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense").reduce((a, t) => a + t.amount, 0);
    expect(s.fixedIncome + s.variableIncome).toBe(income);
    expect(s.fixedExpense + s.variableExpense).toBe(expense);
  });

  it("定期ごとに当てはまった件数を数える（定期の一覧で確かめる用）", () => {
    expect(countMatches(txs, conds)).toEqual({ fc1: 1, rent: 1 });
  });
});

describe("F7 の部品: その期間に条件に当てはまる手入力・CSV の取引があるか", () => {
  const t = [tx({ date: "2026-09-27" })];
  it("毎月の定期は同じ月にあれば「ある」", () => {
    expect(hasMatchingInPeriod(t, cond(), "2026-09-30", "monthly")).toBe(true);
    expect(hasMatchingInPeriod(t, cond(), "2026-08-27", "monthly")).toBe(false);
  });
  it("毎週・隔週は同じ日だけ", () => {
    expect(hasMatchingInPeriod(t, cond(), "2026-09-27", "weekly")).toBe(true);
    expect(hasMatchingInPeriod(t, cond(), "2026-09-28", "weekly")).toBe(false);
  });
  it("自動で作った取引は数えない（それは展開済みの印で防ぐ）", () => {
    expect(hasMatchingInPeriod([tx({ source: "auto" })], cond(), "2026-09-27", "monthly")).toBe(false);
  });
});

describe("今月の予定（未確定）", () => {
  const src = (over: Partial<UpcomingSource> = {}): UpcomingSource => ({
    ...cond(),
    name: "仕送り",
    cycle: "monthly",
    billingDay: 27,
    billingMonth: null,
    startDate: "2026-10-14",
    endDate: null,
    isActive: true,
    generatedThrough: "2026-10-14",
    ...over,
  });

  it("今日より後・月末までの回を日付順に出す", () => {
    const items = upcomingInMonth({
      sources: [src(), src({ id: "pay", name: "給料", amount: 30000, matchNote: "給料", billingDay: 31 })],
      txs: [],
      month: "2026-10",
      today: "2026-10-14",
    });
    expect(items).toEqual([
      { fixedCostId: "fc1", date: "2026-10-27", name: "仕送り", type: "income", amount: 130000 },
      { fixedCostId: "pay", date: "2026-10-31", name: "給料", type: "income", amount: 30000 },
    ]);
  });

  it("一時停止中・展開済み・過ぎた月は出さない", () => {
    expect(upcomingInMonth({ sources: [src({ isActive: false })], txs: [], month: "2026-10", today: "2026-10-14" })).toEqual([]);
    expect(upcomingInMonth({ sources: [src({ generatedThrough: "2026-10-27" })], txs: [], month: "2026-10", today: "2026-10-14" })).toEqual([]);
    expect(upcomingInMonth({ sources: [src()], txs: [], month: "2026-09", today: "2026-10-14" })).toEqual([]);
  });

  it("その月に条件に当てはまる取引を先に入れてあれば出さない（二重に見込まない）", () => {
    const items = upcomingInMonth({ sources: [src()], txs: [tx({ date: "2026-10-26" })], month: "2026-10", today: "2026-10-14" });
    expect(items).toEqual([]);
  });

  it("今日の回がまだ取引になっていなければ、今日の分も出す", () => {
    const items = upcomingInMonth({
      sources: [src({ billingDay: 14, generatedThrough: "2026-10-13" })],
      txs: [],
      month: "2026-10",
      today: "2026-10-14",
    });
    expect(items.map((i) => i.date)).toEqual(["2026-10-14"]);
  });

  it("来月を見ているときは、その月の全部の回", () => {
    const items = upcomingInMonth({ sources: [src()], txs: [], month: "2026-11", today: "2026-10-14" });
    expect(items.map((i) => i.date)).toEqual(["2026-11-27"]);
  });
});
