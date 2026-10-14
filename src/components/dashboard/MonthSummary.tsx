/**
 * @file components/dashboard/MonthSummary.tsx
 * @description 月の数字のカード（mywork#425 第1弾、設計書 4-6）。
 * 「支出（今日まで）」「収入」「残り」「予定（今日より後）」の4枚に、1行の脚注と「定義」へのリンクを付ける。
 * 数字・文言はすべて /api/v1/summary と lib/aggregate/definitions.ts から（ここで足し算も文言の直書きもしない: D9・D10）。
 * 予定 ＝ 今日より後の日付の取引 ＋ 定期のまだ来ていない回（upcoming）。合計には入っていない。
 * スマホ幅（375px）で6桁の金額が切れないよう、2列×2行・文字は小さめ。
 */

"use client";

import Link from "next/link";
import { DEFINITIONS_PATH, FOOTNOTES } from "@/lib/aggregate/definitions";
import type { SummaryResponse } from "@/types/api";

export function yen(amount: number): string {
  return `¥${Math.floor(Math.abs(amount)).toLocaleString("ja-JP")}`;
}

/** 予定の合計（手入力の予定＋定期の予定） */
export function scheduledTotals(summary: SummaryResponse): { expense: number; income: number; count: number } {
  const upcomingExpense = summary.upcoming.filter((u) => u.type === "expense").reduce((a, u) => a + u.amount, 0);
  const upcomingIncome = summary.upcoming.filter((u) => u.type === "income").reduce((a, u) => a + u.amount, 0);
  return {
    expense: summary.scheduled.expense + upcomingExpense,
    income: summary.scheduled.income + upcomingIncome,
    count: summary.scheduled.count + summary.upcoming.length,
  };
}

export function MonthSummary({ summary }: { summary: SummaryResponse }) {
  const { period } = summary;
  const sched = scheduledTotals(summary);
  const expenseLabel = period.status === "current" ? "支出（今日まで）" : "支出";
  const periodNote =
    period.status === "current" ? FOOTNOTES.period : period.status === "past" ? FOOTNOTES.pastMonth : FOOTNOTES.futureMonth;
  const card = "rounded-xl border p-3 sm:p-4";
  const value = "mt-1 whitespace-nowrap text-base font-bold tabular-nums sm:text-2xl";
  const note = "mt-1 text-[11px] leading-snug text-gray-500";

  return (
    <section aria-label="月の数字" className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className={`${card} border-red-100 bg-red-50`}>
          <p className="text-xs font-medium text-red-600">{expenseLabel}</p>
          <p className={`${value} text-red-700`} data-testid="expense-total">
            -{yen(summary.expense.total)}
          </p>
          <p className={note} data-testid="expense-footnote">{FOOTNOTES.expense}</p>
        </div>
        <div className={`${card} border-green-100 bg-green-50`}>
          <p className="text-xs font-medium text-green-600">収入</p>
          <p className={`${value} text-green-700`} data-testid="income-total">
            +{yen(summary.income.total)}
          </p>
          <p className={note}>{FOOTNOTES.income}</p>
        </div>
        <div className={`${card} ${summary.balance >= 0 ? "border-blue-100 bg-blue-50" : "border-orange-100 bg-orange-50"}`}>
          <p className={`text-xs font-medium ${summary.balance >= 0 ? "text-blue-600" : "text-orange-600"}`}>残り</p>
          <p className={`${value} ${summary.balance >= 0 ? "text-blue-700" : "text-orange-700"}`} data-testid="balance-total">
            {summary.balance >= 0 ? "+" : "-"}
            {yen(summary.balance)}
          </p>
          <p className={note}>{FOOTNOTES.balance}</p>
        </div>
        <div className={`${card} border-dashed border-gray-300 bg-gray-50`}>
          <p className="text-xs font-medium text-gray-600">予定（今日より後）</p>
          <p className={`${value} text-gray-800`} data-testid="scheduled-expense">
            -{yen(sched.expense)}
          </p>
          {sched.income > 0 && (
            <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-green-700" data-testid="scheduled-income">
              +{yen(sched.income)}
            </p>
          )}
          <p className={note}>{sched.count}件。{FOOTNOTES.scheduledShort}</p>
        </div>
      </div>

      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-gray-500" data-testid="period-footnote">
        <span>
          {periodNote}
          {period.status === "current" && (
            <span className="ml-1 tabular-nums">
              （{Number(period.start.slice(5, 7))}/{Number(period.start.slice(8, 10))}〜{Number(period.end.slice(5, 7))}/{Number(period.end.slice(8, 10))}）
            </span>
          )}
        </span>
        <Link href={DEFINITIONS_PATH} className="shrink-0 text-blue-600 hover:underline">
          定義
        </Link>
      </p>

      {summary.expense.refund_heavy && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="refund-heavy">
          {FOOTNOTES.refundHeavy(summary.expense.refund_count, yen(summary.expense.refunds))}
        </p>
      )}
    </section>
  );
}
