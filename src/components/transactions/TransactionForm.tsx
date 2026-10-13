/**
 * @file components/transactions/TransactionForm.tsx
 * @description 収支手動入力フォーム。
 * カレンダーの日付クリック時のモーダル内で使う。
 * 金額・種別・カテゴリ・口座・メモを入力して API に POST する。
 */

"use client";

import { useState } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import type { CreateTransactionRequest } from "@/types/api";

interface TransactionFormProps {
  /** フォームのデフォルト日付（カレンダーでクリックした日） */
  defaultDate: string;
  onSubmit: (data: CreateTransactionRequest) => Promise<boolean>;
  onCancel: () => void;
}

export function TransactionForm({
  defaultDate,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const { accounts } = useAccounts();
  const [type, setType] = useState<"income" | "expense">("expense");
  const { categories } = useCategories(type);

  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!amount || !accountId) {
      setError("金額と口座は必須です");
      return;
    }

    setLoading(true);
    const success = await onSubmit({
      amount: parseFloat(amount),
      type,
      category_id: categoryId || undefined,
      account_id: accountId,
      transaction_date: date,
      note: note || undefined,
      source: "manual",
    });

    setLoading(false);
    if (!success) setError("保存に失敗しました");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 収入 / 支出 切替 */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setType("expense")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            type === "expense"
              ? "bg-red-500 text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          支出
        </button>
        <button
          type="button"
          onClick={() => setType("income")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            type === "income"
              ? "bg-green-500 text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          収入
        </button>
      </div>

      {/* 日付 */}
      <div>
        <label htmlFor="tx-date" className="block text-sm font-medium text-gray-700 mb-1">
          日付
        </label>
        <input
          id="tx-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* 金額 */}
      <div>
        <label htmlFor="tx-amount" className="block text-sm font-medium text-gray-700 mb-1">
          金額（円）
        </label>
        <input
          id="tx-amount"
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          placeholder="1500"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* カテゴリ */}
      <div>
        <label htmlFor="tx-category" className="block text-sm font-medium text-gray-700 mb-1">
          カテゴリ
        </label>
        <select
          id="tx-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">未分類</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      {/* 口座 */}
      <div>
        <label htmlFor="tx-account" className="block text-sm font-medium text-gray-700 mb-1">
          口座 *
        </label>
        <select
          id="tx-account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">選択してください</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </select>
      </div>

      {/* メモ */}
      <div>
        <label htmlFor="tx-note" className="block text-sm font-medium text-gray-700 mb-1">
          メモ
        </label>
        <input
          id="tx-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="コンビニ、電車など"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* ボタン */}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "保存中..." : "保存"}
        </button>
      </div>
    </form>
  );
}
