/**
 * @file components/calendar/DayTransactionList.tsx
 * @description 日付クリック時に表示するモーダルの中身。
 * その日のトランザクション一覧と新規追加フォームを表示する。
 */

"use client";

import { useState } from "react";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import type { TransactionWithRelations } from "@/types/database";
import type { CreateTransactionRequest } from "@/types/api";

interface DayTransactionListProps {
  date: string; // "YYYY-MM-DD"
  transactions: TransactionWithRelations[];
  onAdd: (data: CreateTransactionRequest) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

/** 金額フォーマット */
function formatAmount(amount: number): string {
  return `¥${Math.floor(amount).toLocaleString("ja-JP")}`;
}

export function DayTransactionList({
  date,
  transactions,
  onAdd,
  onDelete,
}: DayTransactionListProps) {
  const [showForm, setShowForm] = useState(false);

  const totalExpense = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const totalIncome = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  async function handleAdd(data: CreateTransactionRequest) {
    const ok = await onAdd(data);
    if (ok) setShowForm(false);
    return ok;
  }

  return (
    <div className="space-y-4">
      {/* 日付サマリー */}
      <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
        <div className="text-sm text-gray-500">
          {date.replace(/-/g, "/")}
        </div>
        <div className="flex gap-4 text-sm font-medium">
          {totalExpense > 0 && (
            <span className="text-red-500">支出 {formatAmount(totalExpense)}</span>
          )}
          {totalIncome > 0 && (
            <span className="text-green-600">収入 +{formatAmount(totalIncome)}</span>
          )}
        </div>
      </div>

      {/* トランザクション一覧 */}
      {transactions.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {transactions.map((tx) => (
            <li key={tx.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                {/* カテゴリカラードット */}
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{
                    backgroundColor: tx.category?.color ?? "#D3D3D3",
                  }}
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {tx.note ?? tx.category?.name ?? "未分類"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {tx.account?.name}
                    {tx.source === "csv" && (
                      <span className="ml-1 rounded bg-blue-100 px-1 py-0.5 text-blue-600">
                        CSV
                      </span>
                    )}
                    {tx.source === "auto" && (
                      <span className="ml-1 rounded bg-purple-100 px-1 py-0.5 text-purple-600">
                        定期
                      </span>
                    )}
                    {tx.source === "receipt" && (
                      <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-amber-700">
                        レシート
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-medium ${
                    tx.type === "expense" ? "text-red-500" : "text-green-600"
                  }`}
                >
                  {tx.type === "expense" ? "-" : "+"}
                  {formatAmount(Number(tx.amount))}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(tx.id)}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  title="削除"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-gray-400">
          この日の収支はありません
        </p>
      )}

      {/* 追加フォーム or 追加ボタン */}
      {showForm ? (
        <TransactionForm
          defaultDate={date}
          onSubmit={handleAdd}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full rounded-lg border-2 border-dashed border-gray-200 py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
        >
          + 収支を追加
        </button>
      )}
    </div>
  );
}
