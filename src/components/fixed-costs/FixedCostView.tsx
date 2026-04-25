/**
 * @file components/fixed-costs/FixedCostView.tsx
 * @description 固定費管理画面（Client Component）。
 * 固定費の一覧表示・追加・有効/無効切替・削除を行う。
 * ログイン時に /api/v1/fixed-costs/generate を呼び出す仕組みもここでトリガーする。
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";

interface FixedCost {
  id: string;
  name: string;
  amount: number;
  billing_day: number;
  is_active: boolean;
  account: { id: string; name: string };
  category: { id: string; name: string; color: string | null } | null;
}

function formatAmount(amount: number): string {
  return `¥${Math.floor(amount).toLocaleString("ja-JP")}`;
}

export function FixedCostView() {
  const { accounts } = useAccounts();
  const { categories } = useCategories("expense");

  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // フォームの状態
  const [form, setForm] = useState({
    name: "",
    amount: "",
    billing_day: "1",
    account_id: "",
    category_id: "",
    is_active: true,
  });

  const fetchFixedCosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/fixed-costs");
      if (!res.ok) throw new Error("固定費の取得に失敗しました");
      const json = await res.json();
      setFixedCosts(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFixedCosts();
  }, [fetchFixedCosts]);

  /** 固定費を追加する */
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name || !form.amount || !form.account_id) {
      setError("名前・金額・口座は必須です");
      return;
    }

    try {
      const res = await fetch("/api/v1/fixed-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          amount: parseFloat(form.amount),
          billing_day: parseInt(form.billing_day),
          account_id: form.account_id,
          category_id: form.category_id || undefined,
          is_active: form.is_active,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? "追加に失敗しました");
      }
      setShowForm(false);
      setForm({
        name: "",
        amount: "",
        billing_day: "1",
        account_id: "",
        category_id: "",
        is_active: true,
      });
      await fetchFixedCosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  /** 有効/無効を切り替える */
  async function toggleActive(id: string, current: boolean) {
    try {
      const res = await fetch(`/api/v1/fixed-costs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !current }),
      });
      if (!res.ok) throw new Error("更新に失敗しました");
      await fetchFixedCosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  /** 固定費を削除する */
  async function handleDelete(id: string) {
    if (!confirm("この固定費を削除しますか？")) return;
    try {
      const res = await fetch(`/api/v1/fixed-costs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("削除に失敗しました");
      await fetchFixedCosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  const totalMonthly = fixedCosts
    .filter((fc) => fc.is_active)
    .reduce((sum, fc) => sum + Number(fc.amount), 0);

  return (
    <div className="p-6 space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">固定費管理</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            毎月自動で収支に追加されます
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + 固定費を追加
        </button>
      </div>

      {/* 月額合計 */}
      {!loading && (
        <div className="rounded-xl bg-purple-50 border border-purple-100 px-5 py-4">
          <p className="text-xs font-medium text-purple-600">有効な固定費の月額合計</p>
          <p className="mt-1 text-2xl font-bold text-purple-700">
            {formatAmount(totalMonthly)}
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 追加フォーム */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-blue-800">固定費を追加</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                名前 *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Spotify, Netflix..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                月額（円）*
              </label>
              <input
                type="number"
                min="1"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="980"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                引き落とし日
              </label>
              <select
                value={form.billing_day}
                onChange={(e) =>
                  setForm({ ...form, billing_day: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}日
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                口座 *
              </label>
              <select
                value={form.account_id}
                onChange={(e) =>
                  setForm({ ...form, account_id: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">選択</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                カテゴリ
              </label>
              <select
                value={form.category_id}
                onChange={(e) =>
                  setForm({ ...form, category_id: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">未分類</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              追加
            </button>
          </div>
        </form>
      )}

      {/* 固定費一覧 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : fixedCosts.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">
          固定費が登録されていません
        </div>
      ) : (
        <ul className="space-y-3">
          {fixedCosts.map((fc) => (
            <li
              key={fc.id}
              className={`flex items-center justify-between rounded-xl border p-4 transition-opacity ${
                fc.is_active
                  ? "border-gray-200 bg-white"
                  : "border-gray-100 bg-gray-50 opacity-60"
              }`}
            >
              <div className="flex items-center gap-3">
                {/* カテゴリカラー */}
                <span
                  className="h-4 w-4 rounded-full shrink-0"
                  style={{
                    backgroundColor: fc.category?.color ?? "#D3D3D3",
                  }}
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">{fc.name}</p>
                  <p className="text-xs text-gray-500">
                    {fc.billing_day}日 · {fc.account?.name}
                    {fc.category && ` · ${fc.category.name}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-900">
                  {formatAmount(Number(fc.amount))}
                </span>

                {/* 有効/無効トグル */}
                <button
                  type="button"
                  onClick={() => toggleActive(fc.id, fc.is_active)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    fc.is_active ? "bg-blue-500" : "bg-gray-300"
                  }`}
                  title={fc.is_active ? "無効にする" : "有効にする"}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      fc.is_active ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </button>

                {/* 削除ボタン */}
                <button
                  type="button"
                  onClick={() => handleDelete(fc.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors text-base leading-none"
                  title="削除"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
