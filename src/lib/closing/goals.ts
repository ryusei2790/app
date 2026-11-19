/**
 * @file lib/closing/goals.ts
 * @description さかのぼって決算・決算から目標（mywork#1238 第2弾）。DB に触らない純粋な関数だけを置く。
 *
 * 本人「先月とかまえの月に遡って決算もできるようにしたい。加入当初で先月の決算から今月の目標決めたい」
 * - 決算できる月: 今月から12か月前まで（未来の月は不可）。以前は「今月と先月だけ」だった
 * - 目標: 月の「支出」の目標額（円）を1つ。決算した月の次の月に付ける（先月を決算すれば今月の目標）
 * - 目標の候補は AI ではなくコードで出す（決算した月の支出を1,000円単位に丸めた「同じくらい・5%減・10%減」）。
 *   数字は計算で作り、AI に作らせない（lib/closing/bot.ts と同じ考え）
 */

import { nextMonth, prevMonth } from "./bot";

/** さかのぼって決算できる月数（今月を含む） */
export const CLOSING_BACK_MONTHS = 12;

/** 目標額の上限（1億円未満。入力ミスで桁が増えたのを止める） */
export const GOAL_MAX = 99_999_999;

/** 決算の月の選択肢（新しい順。今月 → 12か月前） */
export function selectableMonths(today: string, n = CLOSING_BACK_MONTHS): string[] {
  const out = [today.slice(0, 7)];
  while (out.length < n) out.push(prevMonth(out[out.length - 1]));
  return out;
}

/** その月を決算できるか（今月〜12か月前） */
export function isClosableMonth(month: string, today: string): boolean {
  return selectableMonths(today).includes(month);
}

/** その月に目標を付けられるか（決算できる月と、その次の月＝来月まで） */
export function isGoalMonth(month: string, today: string): boolean {
  return isClosableMonth(month, today) || month === nextMonth(today.slice(0, 7));
}

/** 今日から見た月の呼び方（画面と AI の見出しに使う） */
export function monthRelLabel(month: string, today: string): string {
  const cur = today.slice(0, 7);
  if (month === cur) return "今月";
  if (month === prevMonth(cur)) return "先月";
  if (month === nextMonth(cur)) return "来月";
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}

/** 目標額として正しいか（1〜GOAL_MAX の整数）。null は「目標を消す」 */
export function isExpenseGoal(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= GOAL_MAX);
}

export interface GoalSuggestion {
  label: string;
  amount: number;
}

/** 1,000円単位に丸める（目標は細かすぎると覚えにくいので） */
function round1000(v: number): number {
  return Math.round(v / 1000) * 1000;
}

/**
 * 決算した月の支出から、次の月の目標の候補を3つ出す（同じくらい・5%減・10%減）。
 * 支出が0（記録が収入だけ）なら候補は無し。丸めて同じ額になった候補は1つにまとめる。
 */
export function goalSuggestions(expense: number): GoalSuggestion[] {
  if (!(expense > 0)) return [];
  const raw: GoalSuggestion[] = [
    { label: "同じくらい", amount: round1000(expense) },
    { label: "5%減らす", amount: round1000(expense * 0.95) },
    { label: "10%減らす", amount: round1000(expense * 0.9) },
  ];
  const seen = new Set<number>();
  return raw.filter((s) => s.amount >= 1000 && s.amount <= GOAL_MAX && !seen.has(s.amount) && seen.add(s.amount));
}

/** 目標に対する進み具合（画面の「目標 ¥X ／ 使った ¥Y」）。目標が無ければ null */
export function goalProgress(goal: number | null, expense: number): { goal: number; spent: number; left: number; over: boolean } | null {
  if (goal === null) return null;
  return { goal, spent: expense, left: goal - expense, over: expense > goal };
}
