/**
 * @file tests/unit/budget.test.ts
 * @description テスト一覧 M（費目の対応と集計）のうち、DB を使わない部分（lib/budget/*）。
 * - 初期の対応表が経理部 budget.md の当てはめと同じか
 * - M2 メモの語句ルールがカテゴリーより先
 * - M3 対応表に無いカテゴリーは「未割り当て」
 * - M4 枠の外（家賃・事業・光熱費）と収入は枠の合計に入らない
 * - M5 今月の費目別 実績・残額・合計
 * - M6 食費の1日目安
 * - M7 対応表を直すと過去の月も変わる（振り分けを取引に保存しない）
 * - M8 月別推移は直近12か月・取引の無い月は 0
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_FRAMES, DEFAULT_RULES } from "@/lib/budget/defaults";
import { classify, type BudgetRule, type BudgetTx } from "@/lib/budget/classify";
import { monthSummary, monthlyTrend, type BudgetFrame } from "@/lib/budget/summary";

// ─── テスト用の枠と対応表（id は分かりやすい文字列） ─────────────
const frames: BudgetFrame[] = DEFAULT_FRAMES.map((f, i) => ({ id: `F:${f.name}`, ...f, sortOrder: i }));
const cat = (name: string) => `C:${name}`;
const rules: BudgetRule[] = DEFAULT_RULES.map((r, i) => ({
  id: `R${i}`,
  categoryId: "categoryName" in r ? cat(r.categoryName) : null,
  memoKeyword: "memoKeyword" in r ? r.memoKeyword : null,
  frameId: r.frame === null ? null : `F:${r.frame}`,
  priority: i,
}));

const tx = (date: string, amount: number, category: string | null, note: string | null = null, type: "income" | "expense" = "expense"): BudgetTx => ({
  date,
  amount,
  type,
  categoryId: category ? cat(category) : null,
  categoryName: category,
  note,
});

describe("初期の枠と対応表（経理部 budget.md の当てはめ）", () => {
  it("8費目・合計 60,000円、食費は上限 20,000・目標 15,000", () => {
    expect(DEFAULT_FRAMES.map((f) => f.name)).toEqual(["食費", "サブスク", "日用品", "移動", "先取り貯蓄", "自己投資", "自由費", "予備"]);
    expect(DEFAULT_FRAMES.reduce((s, f) => s + f.monthlyLimit, 0)).toBe(60000);
    expect(DEFAULT_FRAMES[0]).toMatchObject({ monthlyLimit: 20000, target: 15000 });
  });

  it.each([
    ["食費", "食費"], ["お菓子", "食費"], ["日用品", "日用品"], ["交通費", "移動"],
    ["外食費", "自由費"], ["趣味", "自由費"], ["衣服", "自由費"], ["交際費", "自由費"], ["その他", "自由費"],
    ["本", "自己投資"],
  ])("%s → %s", (category, frame) => {
    expect(classify(tx("2026-09-01", 100, category), rules)).toEqual({ kind: "frame", frameId: `F:${frame}` });
  });

  it.each(["家賃", "事業", "光熱費"])("%s は枠の外", (category) => {
    expect(classify(tx("2026-09-01", 100, category), rules)).toEqual({ kind: "outside" });
  });
});

describe("M2 メモの語句ルールがカテゴリーより先", () => {
  it.each(["Spotify", "spotify 月額", "Apple Music", "Amazonプライム", "Google One", "アップルストア"])(
    "その他＋メモ「%s」→ サブスク",
    (note) => {
      expect(classify(tx("2026-09-01", 480, "その他", note), rules)).toEqual({ kind: "frame", frameId: "F:サブスク" });
    }
  );

  it("語句の無いメモはカテゴリーで決まる", () => {
    expect(classify(tx("2026-09-01", 480, "その他", "コンビニ"), rules)).toEqual({ kind: "frame", frameId: "F:自由費" });
  });
});

describe("M3・M4 未割り当て・枠の外・収入", () => {
  it("対応表に無いカテゴリー・カテゴリー無しは未割り当て（0円扱いにしない）", () => {
    expect(classify(tx("2026-09-01", 100, "医療"), rules)).toEqual({ kind: "unassigned" });
    expect(classify(tx("2026-09-01", 100, null), rules)).toEqual({ kind: "unassigned" });
  });

  it("収入は枠に入れない", () => {
    expect(classify(tx("2026-09-01", 100, "給料", null, "income"), rules)).toEqual({ kind: "income" });
  });

  it("月の集計: 未割り当ての件数・金額・カテゴリー名、枠の外、収入が別に出る", () => {
    const s = monthSummary({
      txs: [tx("2026-09-01", 100, "医療"), tx("2026-09-02", 50, "医療"), tx("2026-09-27", 59590, "家賃"), tx("2026-09-30", 30000, "給料", null, "income"), tx("2026-09-03", 1000, "食費")],
      rules, frames, month: "2026-09", today: "2026-10-13",
    });
    expect(s.unassigned).toEqual({ count: 2, amount: 150, categories: ["医療"] });
    expect(s.outside).toBe(59590);
    expect(s.income).toBe(30000);
    expect(s.total.spent).toBe(1000); // 枠の合計には食費だけ
  });
});

describe("M5 今月の費目別 実績・残額・合計", () => {
  const s = monthSummary({
    txs: [
      tx("2026-10-01", 3000, "食費"), tx("2026-10-12", 970, "お菓子"), tx("2026-10-05", 6000, "交通費"),
      tx("2026-09-30", 99999, "食費"), // 前月は入らない
      tx("2026-11-01", 99999, "食費"), // 翌月も入らない
    ],
    rules, frames, month: "2026-10", today: "2026-10-13",
  });

  it("費目ごとの実績と残額（超えたら負）", () => {
    const food = s.frames.find((f) => f.name === "食費")!;
    expect(food).toMatchObject({ spent: 3970, limit: 20000, remaining: 16030 });
    const move = s.frames.find((f) => f.name === "移動")!;
    expect(move).toMatchObject({ spent: 6000, limit: 5000, remaining: -1000 });
  });

  it("8費目が枠の並び順で全部出る（使っていない費目は 0）", () => {
    expect(s.frames.map((f) => f.name)).toEqual(DEFAULT_FRAMES.map((f) => f.name));
    expect(s.frames.find((f) => f.name === "予備")!.spent).toBe(0);
  });

  it("合計: 枠 60,000 と実績の差", () => {
    expect(s.total).toEqual({ limit: 60000, spent: 9970, remaining: 50030 });
  });
});

describe("M6 食費の1日目安", () => {
  it("budget.md の 10/13 と同じ: (20,000−16,064)÷19日 = 207円、目標ベースの残額は −1,064", () => {
    const s = monthSummary({ txs: [tx("2026-10-01", 16064, "食費")], rules, frames, month: "2026-10", today: "2026-10-13" });
    expect(s.food).toMatchObject({
      limit: 20000, target: 15000, spent: 16064,
      remainingToLimit: 3936, remainingToTarget: -1064, daysLeft: 19, perDay: 207, perDayTarget: 0,
    });
  });

  it("月末日は ÷1", () => {
    const s = monthSummary({ txs: [tx("2026-10-01", 19000, "食費")], rules, frames, month: "2026-10", today: "2026-10-31" });
    expect(s.food).toMatchObject({ daysLeft: 1, perDay: 1000 });
  });

  it("上限を超えたら 1日目安は 0（マイナスにしない）", () => {
    const s = monthSummary({ txs: [tx("2026-10-01", 25000, "食費")], rules, frames, month: "2026-10", today: "2026-10-13" });
    expect(s.food).toMatchObject({ remainingToLimit: -5000, perDay: 0 });
  });

  it("過ぎた月は残り日数 0・1日目安なし、先の月は月の日数で割る", () => {
    const past = monthSummary({ txs: [], rules, frames, month: "2026-09", today: "2026-10-13" });
    expect(past.food).toMatchObject({ daysLeft: 0, perDay: null });
    const next = monthSummary({ txs: [], rules, frames, month: "2026-11", today: "2026-10-13" });
    expect(next.food).toMatchObject({ daysLeft: 30, perDay: 666 });
  });
});

describe("M7 対応表を直すと過去の月も変わる", () => {
  it("趣味を自由費→自己投資に変えると、9月の集計も自己投資に移る", () => {
    const txs = [tx("2026-09-14", 7700, "趣味")];
    const before = monthSummary({ txs, rules, frames, month: "2026-09", today: "2026-10-13" });
    expect(before.frames.find((f) => f.name === "自由費")!.spent).toBe(7700);

    const changed = rules.map((r) => (r.categoryId === cat("趣味") ? { ...r, frameId: "F:自己投資" } : r));
    const after = monthSummary({ txs, rules: changed, frames, month: "2026-09", today: "2026-10-13" });
    expect(after.frames.find((f) => f.name === "自由費")!.spent).toBe(0);
    expect(after.frames.find((f) => f.name === "自己投資")!.spent).toBe(7700);
  });
});

describe("M8 月別推移", () => {
  const t = monthlyTrend({
    txs: [tx("2026-10-01", 1000, "食費"), tx("2026-08-15", 500, "交通費"), tx("2025-10-31", 9, "食費"), tx("2026-09-30", 30000, "給料", null, "income")],
    rules, frames, endMonth: "2026-10",
  });

  it("直近12か月（古い順）。取引の無い月は 0", () => {
    expect(t.map((m) => m.month)).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(t[0].total).toBe(0); // 2025-10-31 は範囲の外
    expect(t.find((m) => m.month === "2026-01")!.total).toBe(0);
  });

  it("費目ごとの金額と合計、収入は別", () => {
    const oct = t.find((m) => m.month === "2026-10")!;
    expect(oct.byFrame["F:食費"]).toBe(1000);
    expect(oct.total).toBe(1000);
    const sep = t.find((m) => m.month === "2026-09")!;
    expect(sep.income).toBe(30000);
    expect(sep.total).toBe(0);
  });
});
