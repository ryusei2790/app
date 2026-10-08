/**
 * @file components/calendar/CalendarDay.tsx
 * @description カレンダーの1日分のセルコンポーネント。
 * 日付・その日の合計支出・合計収入を表示する。
 * クリックするとその日のトランザクション一覧を開く。
 */

"use client";

import type { TransactionWithRelations } from "@/types/database";

interface CalendarDayProps {
  /** 表示する日（1〜31）*/
  day: number;
  /** 今月の日付かどうか（前月・翌月の日は薄く表示） */
  isCurrentMonth: boolean;
  /** 今日かどうか */
  isToday: boolean;
  /** この日の収支データ */
  transactions: TransactionWithRelations[];
  /** クリック時のコールバック */
  onClick: (day: number) => void;
}

/** 金額を日本語表記にフォーマット（例: 1,500円） */
function formatAmount(amount: number): string {
  return `¥${Math.floor(amount).toLocaleString("ja-JP")}`;
}

export function CalendarDay({
  day,
  isCurrentMonth,
  isToday,
  transactions,
  onClick,
}: CalendarDayProps) {
  // この日の合計支出・収入を計算
  const totalExpense = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalIncome = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const hasTransactions = transactions.length > 0;

  return (
    <button
      type="button"
      aria-current={isToday ? "date" : undefined}
      onClick={() => onClick(day)}
      className={`
        relative min-h-[56px] sm:min-h-[72px] w-full min-w-0 overflow-hidden rounded-lg border p-1 sm:p-2 text-left transition-colors
        hover:bg-blue-50 hover:border-blue-200
        ${isCurrentMonth ? "bg-white border-gray-200" : "bg-gray-50 border-gray-100"}
        ${isToday ? "border-blue-400 ring-1 ring-blue-400" : ""}
        ${hasTransactions ? "cursor-pointer" : "cursor-pointer"}
      `}
    >
      {/* 日付番号 */}
      <span
        className={`
          inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium
          ${isToday ? "bg-blue-500 text-white" : isCurrentMonth ? "text-gray-900" : "text-gray-400"}
        `}
      >
        {day}
      </span>

      {/* 収支サマリー */}
      <div className="mt-1 space-y-0.5">
        {totalExpense > 0 && (
          <div className="text-xs font-medium text-red-500 truncate">
            {formatAmount(totalExpense)}
          </div>
        )}
        {totalIncome > 0 && (
          <div className="text-xs font-medium text-green-600 truncate">
            +{formatAmount(totalIncome)}
          </div>
        )}
      </div>
    </button>
  );
}
