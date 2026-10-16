/**
 * @file components/transactions/TransactionForm.tsx
 * @description 収支手動入力フォーム。
 * カレンダーの日付クリック時のモーダル内で使う。
 * 金額・種別・種類（通常／返金／振替／借入・返済）・カテゴリ・口座・メモを入力して API に POST する。
 */

"use client";

import { useState } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { KIND_HELP, KIND_LABELS, TRANSACTION_KINDS, type TransactionKind } from "@/lib/aggregate/definitions";
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
  // 種類（mywork#425）。返金は「戻ってきたお金」なので向きは収入に固定し、カテゴリーは元の支出のものを選ぶ
  const [kind, setKind] = useState<TransactionKind>("normal");
  const { categories } = useCategories(kind === "refund" ? "expense" : type);

  function changeKind(next: TransactionKind) {
    setKind(next);
    if (next === "refund") setType("income");
  }

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
      kind,
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
          disabled={kind === "refund"}
          className={`flex-1 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
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

      {/* 種類（通常／返金／振替／借入・返済）。集計の定義は lib/aggregate/definitions.ts */}
      <div>
        <label htmlFor="tx-kind" className="block text-sm font-medium text-gray-700 mb-1">
          種類
        </label>
        <select
          id="tx-kind"
          value={kind}
          onChange={(e) => changeKind(e.target.value as TransactionKind)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {TRANSACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">{KIND_HELP[kind]}</p>
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
