/**
 * @file components/calendar/CalendarView.tsx
 * @description 月次カレンダーのメインコンポーネント（Client Component）。
 * 月を切り替えて収支を表示し、日付クリックで詳細モーダルを開く。
 *
 * データフロー:
 * CalendarView → useTransactions → GET /api/v1/transactions
 *              ← トランザクション一覧
 *              → CalendarDay（日付セル）× 最大42個
 *              → Dialog（モーダル）→ DayTransactionList
 */

"use client";

import { useState, useMemo } from "react";
import { CalendarDay } from "./CalendarDay";
import { DayTransactionList } from "./DayTransactionList";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTransactions } from "@/hooks/useTransactions";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 金額フォーマット */
function formatAmount(amount: number): string {
  return `¥${Math.floor(amount).toLocaleString("ja-JP")}`;
}

export function CalendarView() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const { transactions, loading, error, createTransaction, deleteTransaction } =
    useTransactions({ year, month });

  // カレンダーグリッドを構築（前月末・当月・翌月頭を含む最大42マス）
  const calendarGrid = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0=日, 6=土
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

    const cells: Array<{
      day: number;
      isCurrentMonth: boolean;
      date: string; // "YYYY-MM-DD"
    }> = [];

    // 前月の末尾日を埋める
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      cells.push({
        day: d,
        isCurrentMonth: false,
        date: `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }

    // 当月の日を埋める
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        isCurrentMonth: true,
        date: `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }

    // 次月の頭を埋めて6行×7列 = 42マスにする
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      cells.push({
        day: d,
        isCurrentMonth: false,
        date: `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }

    return cells;
  }, [year, month]);

  // 日付ごとのトランザクションマップを生成 { "YYYY-MM-DD": [...] }
  const txByDate = useMemo(() => {
    const map = new Map<string, typeof transactions>();
    for (const tx of transactions) {
      const dateStr = new Date(tx.transaction_date)
        .toISOString()
        .split("T")[0];
      if (!map.has(dateStr)) map.set(dateStr, []);
      map.get(dateStr)!.push(tx);
    }
    return map;
  }, [transactions]);

  // 月のサマリーを計算
  const monthSummary = useMemo(() => {
    const income = transactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const expense = transactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + Number(t.amount), 0);
    return { income, expense, balance: income - expense };
  }, [transactions]);

  // 選択した日のデータ
  const selectedDate = selectedDay
    ? `${year}-${String(month).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
    : null;
  const selectedTransactions = selectedDate
    ? (txByDate.get(selectedDate) ?? [])
    : [];

  /** 月を前後に移動する */
  function changeMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  return (
    <div className="p-6 space-y-4">
      {/* ヘッダー：月移動 + サマリー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => changeMonth(-1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            ← 前月
          </button>
          <h2 className="text-xl font-bold text-gray-900">
            {year}年{month}月
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

        {/* 月次サマリー */}
        {!loading && (
          <div className="flex gap-6 text-sm">
            <span className="text-green-600">
              収入 {formatAmount(monthSummary.income)}
            </span>
            <span className="text-red-500">
              支出 {formatAmount(monthSummary.expense)}
            </span>
            <span
              className={
                monthSummary.balance >= 0 ? "text-blue-600" : "text-orange-500"
              }
            >
              残高 {monthSummary.balance >= 0 ? "+" : ""}
              {formatAmount(monthSummary.balance)}
            </span>
          </div>
        )}
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-2 text-center text-xs font-medium ${
              i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-500"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* カレンダーグリッド */}
      {loading ? (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 42 }).map((_, i) => (
            <div
              key={i}
              className="min-h-[72px] animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {calendarGrid.map((cell, i) => (
            <CalendarDay
              key={`${cell.date}-${i}`}
              day={cell.day}
              isCurrentMonth={cell.isCurrentMonth}
              isToday={
                cell.date ===
                `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
              }
              transactions={
                cell.isCurrentMonth
                  ? (txByDate.get(cell.date) ?? [])
                  : []
              }
              onClick={(day) => {
                if (cell.isCurrentMonth) setSelectedDay(day);
              }}
            />
          ))}
        </div>
      )}

      {/* 日付クリック時のモーダル */}
      <Dialog
        open={selectedDay !== null}
        onOpenChange={(open) => !open && setSelectedDay(null)}
      >
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {year}年{month}月{selectedDay}日
            </DialogTitle>
          </DialogHeader>
          {selectedDate && (
            <DayTransactionList
              date={selectedDate}
              transactions={selectedTransactions}
              onAdd={createTransaction}
              onDelete={deleteTransaction}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
