/**
 * @file lib/ask/answer.ts
 * @description Reading（lib/ask/reader.ts）をコードで集計し、定型文の答えにする（mywork#500 第3弾、設計書 4-8）。
 *
 * - 数字は全部 lib/aggregate の summarize（画面・/api/v1/summary・MCP の monthly_summary と同じ関数）から取る（Q5・D9）
 *   月ごとに summarize を回して足すので、「今月は今日まで」「返金は引く」「振替・借入は入れない」が画面と同じになる
 * - 収入のカテゴリー別だけは summarize に内訳が無いので、同じ splitMonth（今日まで）で行を絞ってから足す
 * - 答えの文はテンプレートだけ（LLM を通さない）。判断の言葉（べき・おすすめ）は出さない
 * DB は読まない（入力の txs は呼ぶ側が withUserDb の中で読む）。
 */

import { splitMonth, summarize, type AggTx, type MonthlySummary } from "@/lib/aggregate/monthly";
import type { FixedCondition } from "@/lib/fixed/classify";
import { addMonths, monthLabel, monthsBetween, type Reading } from "./reader";

export interface AnswerData {
  /** 期間（比較するなら前の期間も）の取引。予定の行も入っていてよい（summarize が分ける） */
  txs: AggTx[];
  today: string;
  fixedConditions: FixedCondition[];
  categories: Array<{ id: string; name: string; color: string | null }>;
}

export interface Answer {
  reading: Reading;
  /** ラベル「計算（N件）」: N は数えた取引の行数 */
  label: string;
  text: string;
  value: number;
  unit: "円" | "件";
  rows: number;
  breakdown?: Array<{ name: string; value: number }>;
  compare?: { label: string; value: number; diff: number };
  /** 補足（件数を数えられない対象など） */
  note?: string;
}

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

export function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** 比べる相手: 同じ長さで直前の期間 */
export function previousPeriod(p: Reading["period"]): Reading["period"] {
  const len = monthsBetween(p.from, p.to);
  const from = addMonths(p.from, -len);
  const to = addMonths(p.from, -1);
  return { from, to, label: len === 1 ? monthLabel(from) : `${monthLabel(from)}〜${monthLabel(to)}` };
}

/** 1か月分の「値・件数・日数」。対象と向きで summarize のどの数字を使うかを決める */
function pick(s: MonthlySummary, monthTxs: AggTx[], r: Reading, today: string): { sum: number; count: number; days: number } {
  const days = s.period.status === "future" ? 0 : Number(s.period.end.slice(8)) - Number(s.period.start.slice(8)) + 1;
  const t = r.target;
  if (r.flow === "income") {
    if (t.type === "category") {
      // 収入の内訳は summarize に無い → 同じ splitMonth で「今日まで」に絞り、普通の収入だけ足す
      const rows = splitMonth(monthTxs, s.month, today).inPeriod.filter((x) => x.type === "income" && x.kind === "normal" && x.categoryId === t.id);
      return { sum: rows.reduce((a, x) => a + x.amount, 0), count: rows.length, days };
    }
    return { sum: s.income.total, count: s.income.count, days };
  }
  if (t.type === "category") {
    const c = s.byCategory.find((b) => b.categoryId === t.id);
    return { sum: c?.amount ?? 0, count: c?.count ?? 0, days };
  }
  const count = s.expense.purchaseCount;
  if (t.type === "fixed") return { sum: s.fixed.fixedExpense, count, days };
  if (t.type === "variable") return { sum: s.fixed.variableExpense, count, days };
  return { sum: s.expense.total, count, days };
}

/** 期間の月ごとの summarize と pick */
function perMonth(r: Reading, period: Reading["period"], data: AnswerData) {
  return monthsOf(period.from, period.to).map((month) => {
    const monthTxs = data.txs.filter((t) => t.date.startsWith(month));
    const s = summarize({ txs: monthTxs, month, today: data.today, fixedConditions: data.fixedConditions, categories: data.categories, budget: null });
    return { month, s, monthTxs, ...pick(s, monthTxs, r, data.today) };
  });
}

function valueOf(r: Reading, rows: Array<{ sum: number; count: number; days: number }>): number {
  const sum = rows.reduce((a, x) => a + x.sum, 0);
  if (r.measure === "count") return rows.reduce((a, x) => a + x.count, 0);
  if (r.measure === "per_day") {
    const days = rows.reduce((a, x) => a + x.days, 0);
    return days > 0 ? Math.round(sum / days) : 0;
  }
  return sum;
}

/**
 * 答えを作る。
 * 1. 期間の月ごとに summarize → 対象の数字を取る
 * 2. 集計（合計・件数・1日あたり）にまとめる
 * 3. 内訳（カテゴリー別・月別）と比較（前の同じ長さの期間）を足す
 * 4. 定型文にする
 */
export function answerReading(r: Reading, data: AnswerData): Answer {
  // 件数は「何回買ったか」なので、固定・変動の対象では数えていない（固定の判定は金額側にしか無い）
  const measure = r.measure === "count" && (r.target.type === "fixed" || r.target.type === "variable") ? "sum" : r.measure;
  const note = measure !== r.measure ? "固定費・変動費の件数は数えていないので、金額を出しました" : undefined;
  const rr: Reading = { ...r, measure };
  // 1つのカテゴリーの「内訳」はカテゴリー別にしても1行だけなので、月別で返す
  if (rr.groupBy === "category" && rr.target.type === "category") rr.groupBy = "month";

  const months = perMonth(rr, rr.period, data);
  const value = valueOf(rr, months);
  const rows = months.reduce((a, m) => a + m.count, 0);
  const unit = measure === "count" ? "件" : "円";
  const fmt = (n: number) => (unit === "件" ? `${n}件` : yen(n));

  let breakdown: Answer["breakdown"];
  if (rr.groupBy === "month") {
    breakdown = months.map((m) => ({ name: monthLabel(m.month), value: valueOf(rr, [m]) }));
  } else if (rr.groupBy === "category") {
    const acc = new Map<string, number>();
    for (const m of months) {
      if (rr.flow === "income") {
        for (const t of splitMonth(m.monthTxs, m.month, data.today).inPeriod) {
          if (t.type !== "income" || t.kind !== "normal") continue;
          const name = data.categories.find((c) => c.id === t.categoryId)?.name ?? "未分類";
          acc.set(name, (acc.get(name) ?? 0) + (measure === "count" ? 1 : t.amount));
        }
      } else {
        for (const c of m.s.byCategory) acc.set(c.name, (acc.get(c.name) ?? 0) + (measure === "count" ? c.count : c.amount));
      }
    }
    breakdown = [...acc.entries()].map(([name, v]) => ({ name, value: v })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ja"));
  }

  let compare: Answer["compare"];
  if (rr.compare) {
    const prev = previousPeriod(rr.period);
    const pv = valueOf(rr, perMonth(rr, prev, data));
    compare = { label: prev.label, value: pv, diff: value - pv };
  }

  // 4. 定型文
  const what = measure === "count" ? "件数" : measure === "per_day" ? "1日あたり" : "合計";
  let text = `${rr.period.label}の${rr.target.name}（${what}）は ${fmt(value)} です。`;
  if (compare) {
    const d = compare.diff;
    text += ` ${compare.label}は ${fmt(compare.value)} で、${d === 0 ? "同じ" : `${fmt(Math.abs(d))} ${d > 0 ? "多い" : "少ない"}`}です。`;
  }
  // 内訳は文に書かず breakdown で返す（画面は棒で出す。同じ数字を二度読ませない）

  return { reading: rr, label: `計算（${rows}件）`, text, value, unit, rows, breakdown, compare, note };
}
