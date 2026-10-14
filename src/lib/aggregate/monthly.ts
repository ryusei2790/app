/**
 * @file lib/aggregate/monthly.ts
 * @description 月の集計を1か所で行う純粋関数 summarize（mywork#425 第1弾、設計書 4-1〜4-3、テスト一覧 D2〜D9）。
 *
 * ダッシュボード・収支一覧の合計・予算台帳・要確認・（第3弾の）質問の答え・回帰テストは、全部この関数の結果を使う。
 * DB には触らない。月の取引（kind 付き）・定期の条件・予算の対応表・今日 を引数でもらう。
 *
 * 定義（lib/aggregate/definitions.ts と同じもの）:
 *   - 期間 ＝ [月初, min(今日, 月末)]。日付 > 今日 の行は「予定」で合計に入れない（過去の月は全部実績、先の月は全部予定）
 *   - 支出 ＝ Σ(購入: expense × normal) − Σ(返金: income × refund)。返金は返金の日付の月・同じカテゴリーから引く
 *   - 収入 ＝ Σ(income × normal)
 *   - 振替（transfer）・借入／返済（loan）は支出にも収入にも入れず、別枠に数える
 *   - 固定／変動 ＝ 定期の条件（lib/fixed/classify.ts）。返金は「同じ条件に当たる支出」と見て、元と同じ側から引く
 *   - 予算の費目 ＝ 対応表（lib/budget/*）。返金は負の支出として同じ費目から引く。振替・借入は費目に入れない
 * 既存の lib/budget・lib/fixed を内側で呼ぶ（定義を2か所に書かない）。
 */

import { daysInMonth } from "@/lib/date/jst";
import type { BudgetRule, BudgetTx } from "@/lib/budget/classify";
import { monthSummary, type BudgetFrame, type MonthSummary as BudgetMonthSummary } from "@/lib/budget/summary";
import { classifyFixed, type FixedCondition, type FixedTx } from "@/lib/fixed/classify";
import { DEFINITIONS_VERSION, REFUND_HEAVY, type TransactionKind } from "./definitions";
import { review, reviewCounts, type ReviewCounts } from "./review";

/** 集計に使う取引1件。DB の行から route が作る（lib/aggregate/load.ts） */
export interface AggTx {
  id?: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** 正の金額（円） */
  amount: number;
  /** お金の向き */
  type: "income" | "expense";
  /** 取引の種類 */
  kind: TransactionKind;
  categoryId: string | null;
  categoryName?: string | null;
  /** カテゴリーの向き（収入のカテゴリーか支出のカテゴリーか）。要確認の返金候補に使う */
  categoryType?: "income" | "expense" | null;
  note: string | null;
  source: string;
}

export type PeriodStatus = "past" | "current" | "future";

export interface Period {
  /** 月初 "YYYY-MM-01" */
  start: string;
  /** 今月なら今日、過去・先の月なら月末 */
  end: string;
  status: PeriodStatus;
}

export interface CategoryTotal {
  categoryId: string;
  name: string;
  color: string | null;
  /** 購入 − 返金（負になりうる: D2） */
  amount: number;
  purchases: number;
  refunds: number;
  /** 購入の件数 */
  count: number;
  /** 支出の合計に対する割合（小数2桁） */
  ratio: number;
}

export interface ScheduledItem {
  id: string | null;
  date: string;
  name: string;
  type: "income" | "expense";
  kind: TransactionKind;
  amount: number;
}

export interface MonthlySummary {
  definitionsVersion: string;
  /** "YYYY-MM" */
  month: string;
  /** JST の今日 "YYYY-MM-DD" */
  today: string;
  period: Period;
  expense: {
    /** 購入 − 返金 */
    total: number;
    purchases: number;
    refunds: number;
    purchaseCount: number;
    refundCount: number;
    /** 返金が多い月（定義 8） */
    refundHeavy: boolean;
  };
  income: { total: number; count: number };
  transfers: { out: number; in: number; count: number };
  loans: { repaid: number; borrowed: number; count: number };
  /** 今日より後の日付の取引（定期のまだ来ていない回は別。lib/fixed/upcoming.ts） */
  scheduled: { expense: number; income: number; count: number; items: ScheduledItem[] };
  /** 収入 − 支出（今日まで） */
  balance: number;
  fixed: { fixedIncome: number; variableIncome: number; fixedExpense: number; variableExpense: number };
  byCategory: CategoryTotal[];
  /** 予算の費目（社長だけ。渡さなければ null） */
  frames: BudgetMonthSummary | null;
  review: ReviewCounts;
}

export interface SummarizeInput {
  txs: AggTx[];
  /** "YYYY-MM" */
  month: string;
  /** JST の今日 "YYYY-MM-DD" */
  today: string;
  fixedConditions?: FixedCondition[];
  budget?: { frames: BudgetFrame[]; rules: BudgetRule[] } | null;
  /** カテゴリーの名前と色（内訳の表示用）。無ければ取引の categoryName を使う */
  categories?: Array<{ id: string; name: string; color: string | null }>;
}

export const UNCATEGORIZED_ID = "uncategorized";
export const UNCATEGORIZED_NAME = "未分類";

/** その月の月末 "YYYY-MM-DD" */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

/** 期間（定義 4・5）。文字列比較で日付の前後が分かる形式（YYYY-MM-DD）だけを使う */
export function periodOf(month: string, today: string): Period {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const thisMonth = today.slice(0, 7);
  if (month < thisMonth) return { start, end, status: "past" };
  if (month > thisMonth) return { start, end, status: "future" };
  return { start, end: today < end ? today : end, status: "current" };
}

/** 月の取引を「今日まで（実績）」と「今日より後（予定）」に分ける。他の月の行は捨てる */
export function splitMonth(txs: AggTx[], month: string, today: string): { inPeriod: AggTx[]; scheduled: AggTx[]; period: Period } {
  const period = periodOf(month, today);
  const inPeriod: AggTx[] = [];
  const scheduled: AggTx[] = [];
  for (const tx of txs) {
    if (tx.date.slice(0, 7) !== month) continue;
    if (tx.date > today) scheduled.push(tx);
    else inPeriod.push(tx);
  }
  return { inPeriod, scheduled, period };
}

/**
 * 予算の集計（lib/budget/summary.ts）に渡す形にする（D7）。
 *   - 購入・収入はそのまま
 *   - 返金は「負の支出」にして、同じカテゴリー・メモの費目から引かれるようにする
 *   - 振替・借入・返済は費目に入れないので落とす
 * 期間（今日まで）の絞り込みは呼ぶ側（splitMonth）が済ませておく。
 */
export function toBudgetTxs(txs: AggTx[]): BudgetTx[] {
  const out: BudgetTx[] = [];
  for (const t of txs) {
    if (t.kind === "transfer" || t.kind === "loan") continue;
    const base = { date: t.date, categoryId: t.categoryId, categoryName: t.categoryName ?? null, note: t.note };
    if (t.kind === "refund") out.push({ ...base, type: "expense", amount: -t.amount });
    else out.push({ ...base, type: t.type, amount: t.amount });
  }
  return out;
}

/** 固定の判定（lib/fixed/classify.ts）に渡す形 */
function asFixedTx(t: AggTx): FixedTx {
  return { date: t.date, amount: t.amount, type: t.type, categoryId: t.categoryId, note: t.note, source: t.source };
}

/** 返金は「同じ条件に当たる支出」と見て、元と同じ側（固定／変動）から引く（D8） */
function refundSide(t: AggTx, conditions: FixedCondition[]): "fixed" | "variable" {
  return classifyFixed({ ...asFixedTx(t), type: "expense", source: "manual" }, conditions);
}

export function summarize(input: SummarizeInput): MonthlySummary {
  const { month, today } = input;
  const conditions = input.fixedConditions ?? [];
  const { inPeriod, scheduled, period } = splitMonth(input.txs, month, today);
  const catInfo = new Map((input.categories ?? []).map((c) => [c.id, c]));

  const expense = { total: 0, purchases: 0, refunds: 0, purchaseCount: 0, refundCount: 0, refundHeavy: false };
  const income = { total: 0, count: 0 };
  const transfers = { out: 0, in: 0, count: 0 };
  const loans = { repaid: 0, borrowed: 0, count: 0 };
  const fixed = { fixedIncome: 0, variableIncome: 0, fixedExpense: 0, variableExpense: 0 };
  const buckets = new Map<string, CategoryTotal>();

  const bucketOf = (t: AggTx): CategoryTotal => {
    const key = t.categoryId ?? UNCATEGORIZED_ID;
    let b = buckets.get(key);
    if (!b) {
      const info = t.categoryId ? catInfo.get(t.categoryId) : undefined;
      b = {
        categoryId: key,
        name: info?.name ?? t.categoryName ?? UNCATEGORIZED_NAME,
        color: info?.color ?? null,
        amount: 0,
        purchases: 0,
        refunds: 0,
        count: 0,
        ratio: 0,
      };
      buckets.set(key, b);
    }
    return b;
  };

  // 1. 今日までの行を種類ごとに足す
  for (const t of inPeriod) {
    switch (t.kind) {
      case "transfer": {
        if (t.type === "expense") transfers.out += t.amount;
        else transfers.in += t.amount;
        transfers.count += 1;
        break;
      }
      case "loan": {
        if (t.type === "expense") loans.repaid += t.amount;
        else loans.borrowed += t.amount;
        loans.count += 1;
        break;
      }
      case "refund": {
        // 支出の戻り。同じカテゴリーから引き、固定／変動も元と同じ側から引く
        expense.refunds += t.amount;
        expense.refundCount += 1;
        const b = bucketOf(t);
        b.refunds += t.amount;
        b.amount -= t.amount;
        if (refundSide(t, conditions) === "fixed") fixed.fixedExpense -= t.amount;
        else fixed.variableExpense -= t.amount;
        break;
      }
      default: {
        const side = classifyFixed(asFixedTx(t), conditions);
        if (t.type === "expense") {
          expense.purchases += t.amount;
          expense.purchaseCount += 1;
          const b = bucketOf(t);
          b.purchases += t.amount;
          b.amount += t.amount;
          b.count += 1;
          if (side === "fixed") fixed.fixedExpense += t.amount;
          else fixed.variableExpense += t.amount;
        } else {
          income.total += t.amount;
          income.count += 1;
          if (side === "fixed") fixed.fixedIncome += t.amount;
          else fixed.variableIncome += t.amount;
        }
      }
    }
  }
  expense.total = expense.purchases - expense.refunds;
  expense.refundHeavy =
    expense.refundCount >= REFUND_HEAVY.count || (expense.refunds > 0 && expense.refunds >= expense.purchases * REFUND_HEAVY.ratio);

  // 2. 内訳（金額の大きい順）。合計が 0 以下なら割合は出さない
  const byCategory = [...buckets.values()]
    .map((b) => ({ ...b, ratio: expense.total > 0 ? Math.round((b.amount / expense.total) * 100) / 100 : 0 }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ja"));

  // 3. 予定（今日より後）。支出は返金を引いた額、振替・借入は件数にだけ入れる
  const scheduledTotals = { expense: 0, income: 0 };
  for (const t of scheduled) {
    if (t.kind === "normal") {
      if (t.type === "expense") scheduledTotals.expense += t.amount;
      else scheduledTotals.income += t.amount;
    } else if (t.kind === "refund") scheduledTotals.expense -= t.amount;
  }
  const items: ScheduledItem[] = scheduled
    .map((t) => ({
      id: t.id ?? null,
      date: t.date,
      name: t.note ?? (t.categoryId ? catInfo.get(t.categoryId)?.name : undefined) ?? t.categoryName ?? UNCATEGORIZED_NAME,
      type: t.type,
      kind: t.kind,
      amount: t.amount,
    }))
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "ja") : a.date < b.date ? -1 : 1));

  // 4. 予算の費目（社長だけ）。同じ入力から作るので、ダッシュボードと予算台帳の数字がそろう（D9）
  const frames = input.budget
    ? monthSummary({ txs: toBudgetTxs(inPeriod), rules: input.budget.rules, frames: input.budget.frames, month, today })
    : null;

  return {
    definitionsVersion: DEFINITIONS_VERSION,
    month,
    today,
    period,
    expense,
    income,
    transfers,
    loans,
    scheduled: { ...scheduledTotals, count: scheduled.length, items },
    balance: income.total - expense.total,
    fixed,
    byCategory,
    frames,
    review: reviewCounts(review([...inPeriod, ...scheduled], { month, today })),
  };
}
