/**
 * @file components/dashboard/DashboardView.tsx
 * @description ダッシュボードのメインコンポーネント（Client Component）。
 * 月の数字（4カード・脚注・定義へのリンク）・固定と変動の内訳・予定・要確認の件数・カテゴリー別の内訳を表示する。
 * 数字はすべて GET /api/v1/summary（lib/aggregate の summarize）。ここでは足し算をしない（mywork#425 第1弾 D9）。
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import { MonthSummary } from "./MonthSummary";
import { CategoryPieChart } from "./CategoryPieChart";
import { FixedBreakdown } from "./FixedBreakdown";
import { UpcomingList } from "./UpcomingList";
import { FOOTNOTES } from "@/lib/aggregate/definitions";
import { currentMonthKey, shiftMonthKey, useMonthlySummary } from "@/hooks/useDashboardSummary";
import { ErrorNotice } from "@/components/ui/error-notice";

export function DashboardView() {
  const [month, setMonth] = useState(currentMonthKey());
  const { summary, loading, error, refetch } = useMonthlySummary(month);
  const [y, m] = month.split("-").map(Number);
  const reviewCount = summary ? summary.review.refund_candidates + summary.review.unassigned + summary.review.duplicates : 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* ヘッダー（スマホ幅でも1行に収まるよう、狭い画面では「10月」だけにする） */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        <button
          onClick={() => setMonth(shiftMonthKey(month, -1))}
          className="shrink-0 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          ← 前月
        </button>
        <h2 className="text-lg font-bold text-gray-900 sm:text-xl">
          {y}年{m}月<span className="hidden sm:inline">のダッシュボード</span>
        </h2>
        <button
          onClick={() => setMonth(shiftMonthKey(month, 1))}
          className="shrink-0 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          翌月 →
        </button>
        <button
          onClick={() => setMonth(currentMonthKey())}
          className="shrink-0 whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100"
        >
          今月
        </button>
      </div>

      {error && <ErrorNotice message={error} onRetry={refetch} />}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        </div>
      ) : summary ? (
        <div className="space-y-6">
          {/* 支出（今日まで）・収入・残り・予定 */}
          <MonthSummary summary={summary} />

          {/* 要確認（返金候補・未割り当て・重複候補）。予定は上のカードに出ている */}
          <Link
            href={`/review?month=${month}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm hover:bg-gray-50"
          >
            <span className="min-w-0 text-gray-700">
              <span className="block">
                🔍 要確認 <span className="font-semibold tabular-nums" data-testid="review-count">{reviewCount}件</span>
              </span>
              <span className="block text-xs text-gray-500">返金候補・カテゴリーなし・重複候補</span>
            </span>
            <span className="shrink-0 text-blue-600">→</span>
          </Link>

          {/* 固定の収入／固定の支出／変動の支出（mywork#229） */}
          <section className="space-y-1">
            <FixedBreakdown fixed={summary.fixed} />
            <p className="text-[11px] text-gray-500">{FOOTNOTES.fixed}</p>
          </section>

          {/* 予定（定期の未展開の回＋今日より後の取引）。合計には入れず別枠で見せる */}
          <UpcomingList items={summary.upcoming} scheduled={summary.scheduled.items} balance={summary.balance} />

          {/* カテゴリ別支出（購入 − 返金） */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="mb-1 text-base font-semibold text-gray-900">カテゴリ別支出</h3>
            <p className="mb-4 text-xs text-gray-500">各カテゴリーの購入から同じカテゴリーの返金を引いた額。合計はカードの支出と同じです</p>
            <CategoryPieChart data={summary.by_category} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
