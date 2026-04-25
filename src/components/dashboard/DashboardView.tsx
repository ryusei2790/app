/**
 * @file components/dashboard/DashboardView.tsx
 * @description ダッシュボードのメインコンポーネント（Client Component）。
 * 月次サマリー + カテゴリ別円グラフを表示する。
 */

"use client";

import { useState } from "react";
import { MonthSummary } from "./MonthSummary";
import { CategoryPieChart } from "./CategoryPieChart";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";

export function DashboardView() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const { summary, loading, error } = useDashboardSummary(year, month);

  function changeMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  return (
    <div className="p-6 space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => changeMonth(-1)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          ← 前月
        </button>
        <h2 className="text-xl font-bold text-gray-900">
          {year}年{month}月のダッシュボード
        </h2>
        <button
          onClick={() => changeMonth(1)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          翌月 →
        </button>
        <button
          onClick={() => {
            setYear(today.getFullYear());
            setMonth(today.getMonth() + 1);
          }}
          className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100"
        >
          今月
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl bg-gray-100"
              />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        </div>
      ) : summary ? (
        <div className="space-y-6">
          {/* 月次サマリーカード */}
          <MonthSummary
            totalIncome={summary.total_income}
            totalExpense={summary.total_expense}
            balance={summary.balance}
          />

          {/* カテゴリ別支出 */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="mb-4 text-base font-semibold text-gray-900">
              カテゴリ別支出
            </h3>
            <CategoryPieChart data={summary.by_category} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
