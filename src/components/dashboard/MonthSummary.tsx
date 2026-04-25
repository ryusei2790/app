/**
 * @file components/dashboard/MonthSummary.tsx
 * @description 月次収支サマリーカード。
 * 合計収入・合計支出・残高を3カードで横並びに表示する。
 */

"use client";

interface MonthSummaryProps {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

function formatAmount(amount: number): string {
  return `¥${Math.floor(Math.abs(amount)).toLocaleString("ja-JP")}`;
}

export function MonthSummary({
  totalIncome,
  totalExpense,
  balance,
}: MonthSummaryProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {/* 収入カード */}
      <div className="rounded-xl bg-green-50 border border-green-100 p-4">
        <p className="text-xs font-medium text-green-600">合計収入</p>
        <p className="mt-1 text-2xl font-bold text-green-700">
          +{formatAmount(totalIncome)}
        </p>
      </div>

      {/* 支出カード */}
      <div className="rounded-xl bg-red-50 border border-red-100 p-4">
        <p className="text-xs font-medium text-red-600">合計支出</p>
        <p className="mt-1 text-2xl font-bold text-red-700">
          -{formatAmount(totalExpense)}
        </p>
      </div>

      {/* 残高カード */}
      <div
        className={`rounded-xl border p-4 ${
          balance >= 0
            ? "bg-blue-50 border-blue-100"
            : "bg-orange-50 border-orange-100"
        }`}
      >
        <p
          className={`text-xs font-medium ${
            balance >= 0 ? "text-blue-600" : "text-orange-600"
          }`}
        >
          収支残高
        </p>
        <p
          className={`mt-1 text-2xl font-bold ${
            balance >= 0 ? "text-blue-700" : "text-orange-700"
          }`}
        >
          {balance >= 0 ? "+" : "-"}
          {formatAmount(balance)}
        </p>
      </div>
    </div>
  );
}
