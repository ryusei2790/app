/**
 * @file components/dashboard/DashboardView.tsx
 * @description ダッシュボードのメインコンポーネント（Client Component）。
 * 月次サマリー・固定と変動の内訳・今月の予定（未確定）・カテゴリ別円グラフを表示する。
 */

"use client";

import { useState } from "react";
import { MonthSummary } from "./MonthSummary";
import { CategoryPieChart } from "./CategoryPieChart";
import { FixedBreakdown } from "./FixedBreakdown";
import { UpcomingList } from "./UpcomingList";
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
    <div className="p-4 sm:p-6 space-y-6">
      {/* ヘッダー（スマホ幅でも1行に収まるよう、狭い画面では「10月」だけにする） */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        <button
          onClick={() => changeMonth(-1)}
          className="shrink-0 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          ← 前月
        </button>
        <h2 className="text-lg font-bold text-gray-900 sm:text-xl">
          {year}年{month}月<span className="hidden sm:inline">のダッシュボード</span>
        </h2>
        <button
          onClick={() => changeMonth(1)}
          className="shrink-0 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          翌月 →
        </button>
        <button
          onClick={() => {
            setYear(today.getFullYear());
            setMonth(today.getMonth() + 1);
          }}
          className="shrink-0 whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100"
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

          {/* 固定の収入／固定の支出／変動の支出（mywork#229） */}
          <FixedBreakdown fixed={summary.fixed} />

          {/* 今月の予定（未確定）。合計には入れず別枠で見せる */}
          <UpcomingList items={summary.upcoming} balance={summary.balance} />

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
