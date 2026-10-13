/**
 * @file components/transactions/TransactionList.tsx
 * @description 収支一覧コンポーネント（Client Component）。
 * 月次の収支を一覧表示する。種別・カテゴリ・口座でフィルタリングできる。
 * 新規追加は Dialog 内の TransactionForm で行う。
 */

"use client";

import { useState } from "react";
import { useTransactions } from "@/hooks/useTransactions";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { TransactionForm } from "./TransactionForm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** 金額フォーマット */
function formatAmount(amount: number): string {
  return `¥${Math.floor(amount).toLocaleString("ja-JP")}`;
}

/** ソースバッジ */
function SourceBadge({ source }: { source: string }) {
  const config: Record<string, { label: string; class: string }> = {
    manual: { label: "手動", class: "bg-gray-100 text-gray-600" },
    csv: { label: "CSV", class: "bg-blue-100 text-blue-600" },
    auto: { label: "定期", class: "bg-purple-100 text-purple-600" },
    receipt: { label: "レシート", class: "bg-amber-100 text-amber-700" },
  };
  const c = config[source] ?? config.manual;
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.class}`}>
      {c.label}
    </span>
  );
}

export function TransactionList() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [filterType, setFilterType] = useState<"" | "income" | "expense">("");
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { transactions, loading, error, createTransaction, deleteTransaction } =
    useTransactions({
      year,
      month,
      ...(filterType ? { type: filterType } : {}),
    } as Parameters<typeof useTransactions>[0]);

  const { accounts } = useAccounts();
  const { categories } = useCategories();

  function changeMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  const totalExpense = transactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = transactions
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + Number(t.amount), 0);

  // カテゴリ・口座の名前をIDから引けるマップ
  const categoryMap = Object.fromEntries(
    categories.map((c) => [c.id, c])
  );
  const accountMap = Object.fromEntries(
    accounts.map((a) => [a.id, a])
  );

  return (
    <div className="p-6 space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => changeMonth(-1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            ← 前月
          </button>
          <h2 className="text-xl font-bold text-gray-900">
            {year}年{month}月 収支一覧
          </h2>
          <button
            onClick={() => changeMonth(1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            翌月 →
          </button>
        </div>

        {/* フィルター */}
        <div className="flex items-center gap-2">
          {(["", "expense", "income"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filterType === t
                  ? "bg-blue-600 text-white"
                  : "border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t === "" ? "すべて" : t === "expense" ? "支出" : "収入"}
            </button>
          ))}
        </div>

        {/* 追加ボタン */}
        <button
          onClick={() => setShowAddDialog(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + 収支を追加
        </button>
      </div>

      {/* 月次サマリー行 */}
      <div className="flex gap-6 rounded-lg bg-gray-50 px-4 py-3 text-sm">
        <span className="text-green-600 font-medium">
          収入 +{formatAmount(totalIncome)}
        </span>
        <span className="text-red-500 font-medium">
          支出 -{formatAmount(totalExpense)}
        </span>
        <span
          className={`font-medium ${
            totalIncome - totalExpense >= 0 ? "text-blue-600" : "text-orange-500"
          }`}
        >
          残高{" "}
          {totalIncome - totalExpense >= 0 ? "+" : ""}
          {formatAmount(totalIncome - totalExpense)}
        </span>
        <span className="ml-auto text-gray-500">{transactions.length} 件</span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 収支テーブル */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">
          この期間の収支はありません
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">日付</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">内容</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">カテゴリ</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">口座</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">種別</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">金額</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((tx) => (
                <tr
                  key={tx.id}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(tx.transaction_date).toLocaleDateString("ja-JP", {
                      month: "numeric",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {tx.category?.color && (
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: tx.category.color }}
                        />
                      )}
                      <span className="text-gray-900">
                        {tx.note ?? tx.category?.name ?? "未分類"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {tx.category?.name ?? "未分類"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {tx.account?.name ?? "-"}
                  </td>
                  <td className="px-4 py-3">
                    <SourceBadge source={tx.source} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`font-medium ${
                        tx.type === "expense" ? "text-red-500" : "text-green-600"
                      }`}
                    >
                      {tx.type === "expense" ? "-" : "+"}
                      {formatAmount(Number(tx.amount))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteTransaction(tx.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors text-base leading-none"
                      title="削除"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 収支追加ダイアログ */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>収支を追加</DialogTitle>
          </DialogHeader>
          <TransactionForm
            defaultDate={`${year}-${String(month).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`}
            onSubmit={async (data) => {
              const ok = await createTransaction(data);
              if (ok) setShowAddDialog(false);
              return ok;
            }}
            onCancel={() => setShowAddDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
