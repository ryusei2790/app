/**
 * @file lib/budget/summary.ts
 * @description 予算の集計（純粋関数。テスト一覧 M3〜M8）。
 *   - monthSummary: ある月の費目別 実績・残額・合計、枠の外・未割り当て・収入、食費の1日目安
 *   - monthlyTrend: 直近12か月の費目別の推移
 * 取引・対応表・枠は呼ぶ側（api/v1/budget）が DB から読んで渡す。日付は "YYYY-MM-DD" の文字列で扱い、
 * サーバーの TZ に左右されないようにする（lib/date/jst.ts と同じ考え方）。
 */

import { daysInMonth } from "@/lib/date/jst";
import { FOOD_FRAME_NAME } from "./defaults";
import { classify, sortRules, type BudgetRule, type BudgetTx } from "./classify";

export interface BudgetFrame {
  id: string;
  name: string;
  monthlyLimit: number;
  target: number | null;
  sortOrder: number;
}

export interface FrameResult {
  id: string;
  name: string;
  limit: number;
  target: number | null;
  spent: number;
  /** 上限 − 実績（超えたら負） */
  remaining: number;
}

export interface FoodCard {
  limit: number;
  target: number | null;
  spent: number;
  remainingToLimit: number;
  /** 目標が無ければ null */
  remainingToTarget: number | null;
  /** 今日を含む月末までの日数。過ぎた月は 0、先の月はその月の日数 */
  daysLeft: number;
  /** max(上限−実績, 0) ÷ daysLeft（切り捨て）。daysLeft = 0 なら null */
  perDay: number | null;
  perDayTarget: number | null;
}

export interface MonthSummary {
  month: string;
  frames: FrameResult[];
  total: { limit: number; spent: number; remaining: number };
  outside: number;
  income: number;
  unassigned: { count: number; amount: number; categories: string[] };
  food: FoodCard | null;
}

const monthOf = (date: string) => date.slice(0, 7);

/** "YYYY-MM" から n か月ずらす */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** 今日を含む月末までの日数（M6）。過ぎた月 0、先の月は月の日数 */
function daysLeftIn(month: string, today: string): number {
  const [y, m] = month.split("-").map(Number);
  const total = daysInMonth(y, m);
  const thisMonth = monthOf(today);
  if (month < thisMonth) return 0;
  if (month > thisMonth) return total;
  return total - Number(today.slice(8, 10)) + 1;
}

const perDayOf = (remaining: number, days: number) => (days === 0 ? null : Math.floor(Math.max(remaining, 0) / days));

export function monthSummary(input: {
  txs: BudgetTx[];
  rules: BudgetRule[];
  frames: BudgetFrame[];
  /** "YYYY-MM" */
  month: string;
  /** JST の今日 "YYYY-MM-DD" */
  today: string;
}): MonthSummary {
  const { txs, rules, frames, month, today } = input;
  const sorted = sortRules(rules);
  const spent = new Map<string, number>(frames.map((f) => [f.id, 0]));
  let outside = 0;
  let income = 0;
  const unassigned = { count: 0, amount: 0, categories: new Set<string>() };

  // 1. その月の取引を1件ずつ振り分けて足す
  for (const tx of txs) {
    if (monthOf(tx.date) !== month) continue;
    const b = classify(tx, rules, sorted);
    if (b.kind === "income") income += tx.amount;
    else if (b.kind === "outside") outside += tx.amount;
    else if (b.kind === "unassigned") {
      unassigned.count += 1;
      unassigned.amount += tx.amount;
      unassigned.categories.add(tx.categoryName ?? "（カテゴリーなし）");
    } else if (spent.has(b.frameId)) spent.set(b.frameId, spent.get(b.frameId)! + tx.amount);
    else {
      // 消えた枠を指すルール（通常は無い）。黙って捨てずに未割り当てに入れる
      unassigned.count += 1;
      unassigned.amount += tx.amount;
    }
  }

  // 2. 枠ごとの結果（並び順どおり）と合計
  const ordered = [...frames].sort((a, b) => a.sortOrder - b.sortOrder);
  const frameResults: FrameResult[] = ordered.map((f) => {
    const s = spent.get(f.id) ?? 0;
    return { id: f.id, name: f.name, limit: f.monthlyLimit, target: f.target, spent: s, remaining: f.monthlyLimit - s };
  });
  const limit = frameResults.reduce((a, f) => a + f.limit, 0);
  const totalSpent = frameResults.reduce((a, f) => a + f.spent, 0);

  // 3. 食費カード: 1日目安 = 残額 ÷ 今日を含む残り日数（budget.md の 10/13 の計算と同じ式）
  const foodFrame = frameResults.find((f) => f.name === FOOD_FRAME_NAME);
  let food: FoodCard | null = null;
  if (foodFrame) {
    const daysLeft = daysLeftIn(month, today);
    const remainingToTarget = foodFrame.target === null ? null : foodFrame.target - foodFrame.spent;
    food = {
      limit: foodFrame.limit,
      target: foodFrame.target,
      spent: foodFrame.spent,
      remainingToLimit: foodFrame.remaining,
      remainingToTarget,
      daysLeft,
      perDay: perDayOf(foodFrame.remaining, daysLeft),
      perDayTarget: remainingToTarget === null ? null : perDayOf(remainingToTarget, daysLeft),
    };
  }

  return {
    month,
    frames: frameResults,
    total: { limit, spent: totalSpent, remaining: limit - totalSpent },
    outside,
    income,
    unassigned: { count: unassigned.count, amount: unassigned.amount, categories: [...unassigned.categories].sort() },
    food,
  };
}

export interface TrendMonth {
  month: string;
  /** 費目 id → 金額 */
  byFrame: Record<string, number>;
  /** 枠の中の合計 */
  total: number;
  outside: number;
  unassigned: number;
  income: number;
}

/** endMonth を含む直近 months か月（古い順）。取引の無い月も 0 で出す（M8） */
export function monthlyTrend(input: {
  txs: BudgetTx[];
  rules: BudgetRule[];
  frames: BudgetFrame[];
  endMonth: string;
  months?: number;
}): TrendMonth[] {
  const n = input.months ?? 12;
  const sorted = sortRules(input.rules);
  const frameIds = new Set(input.frames.map((f) => f.id));
  const result = new Map<string, TrendMonth>();
  for (let i = n - 1; i >= 0; i--) {
    const m = shiftMonth(input.endMonth, -i);
    result.set(m, {
      month: m,
      byFrame: Object.fromEntries(input.frames.map((f) => [f.id, 0])),
      total: 0,
      outside: 0,
      unassigned: 0,
      income: 0,
    });
  }

  for (const tx of input.txs) {
    const row = result.get(monthOf(tx.date));
    if (!row) continue; // 範囲の外
    const b = classify(tx, input.rules, sorted);
    if (b.kind === "income") row.income += tx.amount;
    else if (b.kind === "outside") row.outside += tx.amount;
    else if (b.kind === "frame" && frameIds.has(b.frameId)) {
      row.byFrame[b.frameId] += tx.amount;
      row.total += tx.amount;
    } else row.unassigned += tx.amount;
  }
  return [...result.values()];
}
