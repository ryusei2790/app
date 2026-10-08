/**
 * @file components/receipts/ReceiptReview.tsx
 * @description 読み取った下書きを確認・修正して保存する（設計書 B5・B6、テスト一覧 P8・W4）。
 * AI の結果は自動では保存しない。利用者が「保存」を押したときに、画面の値だけを POST /api/v1/receipts に送る。
 * 警告（読めない・合計が合わない等）は該当の欄の上にまとめて出す。対象外（外貨など）は保存させず手入力へ。
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import type { ReceiptDraft } from "@/lib/receipt/schema";

interface Props {
  draft: ReceiptDraft;
  model: string;
  onSaved: () => void;
  onRetake: () => void;
}

export function ReceiptReview({ draft, model, onSaved, onRetake }: Props) {
  const { accounts } = useAccounts();
  const { categories } = useCategories("expense");
  const [merchant, setMerchant] = useState(draft.merchant ?? "");
  const [date, setDate] = useState(draft.date ?? "");
  const [total, setTotal] = useState(draft.total !== null ? String(draft.total) : "");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 口座が1つだけなら最初から選んでおく（よくある「財布」だけの人の手間を減らす）
  const account = accountId || (accounts.length === 1 ? accounts[0].id : "");

  if (draft.status === "unsupported") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-gray-100 p-4 text-sm text-gray-700" role="alert">
          {draft.warnings.map((w) => <p key={w.code}>{w.message}</p>)}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onRetake} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm">撮り直す</button>
          <Link href="/calendar" className="flex-1 rounded-lg bg-blue-600 py-2 text-center text-sm font-medium text-white">手入力する</Link>
        </div>
      </div>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!merchant || !date || !total || !account) {
      setError("店名・日付・合計・口座を入力してください");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: account,
          category_id: categoryId || null,
          transaction_date: date,
          total: Number(total),
          merchant,
          items: draft.items,
          model,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "保存に失敗しました");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const label = "block text-xs font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {draft.warnings.length > 0 && (
        <ul className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 space-y-1" role="alert" aria-label="確認してほしい点">
          {draft.warnings.map((w) => <li key={w.code}>⚠️ {w.message}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rc-merchant" className={label}>店名</label>
          <input id="rc-merchant" className={input} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rc-date" className={label}>日付</label>
          <input id="rc-date" type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rc-total" className={label}>合計（円）</label>
          <input id="rc-total" type="number" inputMode="numeric" min="1" step="1" className={input} value={total} onChange={(e) => setTotal(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rc-account" className={label}>口座</label>
          <select id="rc-account" className={input} value={account} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">選択</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rc-category" className={label}>カテゴリ</label>
          <select id="rc-category" className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">未分類</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {draft.items.length > 0 && (
        <details className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer text-gray-700">明細 {draft.items.length} 行</summary>
          <ul className="mt-2 divide-y divide-gray-100">
            {draft.items.map((it, i) => (
              <li key={i} className="flex justify-between py-1">
                <span className="truncate pr-2">{it.name}{it.quantity && it.quantity > 1 ? ` ×${it.quantity}` : ""}</span>
                <span className="shrink-0">¥{it.amount.toLocaleString("ja-JP")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}

      <div className="flex gap-2">
        <button type="button" onClick={onRetake} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-600">撮り直す</button>
        <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </form>
  );
}
