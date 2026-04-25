/**
 * @file components/settings/SettingsView.tsx
 * @description 設定画面（Client Component）。
 * 口座管理（追加・削除）とカスタムカテゴリ管理（追加・削除）を行う。
 * タブ切替で口座/カテゴリを切り替える。
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import type { Account, Category } from "@/types/database";

type Tab = "accounts" | "categories";

const ACCOUNT_TYPES = [
  { value: "cash", label: "現金" },
  { value: "credit_card", label: "クレジットカード" },
  { value: "bank", label: "銀行口座" },
] as const;

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("accounts");

  // ─── 口座管理 ──────────────────────────────────────────
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accLoading, setAccLoading] = useState(true);
  const [accError, setAccError] = useState<string | null>(null);
  const [accForm, setAccForm] = useState({ name: "", type: "cash" as Account["type"] });
  const [showAccForm, setShowAccForm] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setAccLoading(true);
    try {
      const res = await fetch("/api/v1/accounts");
      if (!res.ok) throw new Error("口座の取得に失敗しました");
      const json = await res.json();
      setAccounts(json.data);
    } catch (e) {
      setAccError(e instanceof Error ? e.message : "不明なエラー");
    } finally {
      setAccLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setAccError(null);
    if (!accForm.name) { setAccError("口座名は必須です"); return; }
    try {
      const res = await fetch("/api/v1/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: accForm.name, type: accForm.type, currency: "JPY" }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? "追加に失敗しました");
      }
      setAccForm({ name: "", type: "cash" });
      setShowAccForm(false);
      await fetchAccounts();
    } catch (e) {
      setAccError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  async function handleDeleteAccount(id: string) {
    if (!confirm("この口座を削除しますか？（関連する収支がある場合は削除できません）")) return;
    try {
      const res = await fetch(`/api/v1/accounts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? "削除に失敗しました");
      }
      await fetchAccounts();
    } catch (e) {
      setAccError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  // ─── カテゴリ管理 ────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);
  const [catForm, setCatForm] = useState({
    name: "", type: "expense" as "income" | "expense", color: "#4ECDC4",
  });
  const [showCatForm, setShowCatForm] = useState(false);

  const fetchCategories = useCallback(async () => {
    setCatLoading(true);
    try {
      const res = await fetch("/api/v1/categories");
      if (!res.ok) throw new Error("カテゴリの取得に失敗しました");
      const json = await res.json();
      setCategories(json.data);
    } catch (e) {
      setCatError(e instanceof Error ? e.message : "不明なエラー");
    } finally {
      setCatLoading(false);
    }
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    setCatError(null);
    if (!catForm.name) { setCatError("カテゴリ名は必須です"); return; }
    try {
      const res = await fetch("/api/v1/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: catForm.name, type: catForm.type, color: catForm.color }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? "追加に失敗しました");
      }
      setCatForm({ name: "", type: "expense", color: "#4ECDC4" });
      setShowCatForm(false);
      await fetchCategories();
    } catch (e) {
      setCatError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  async function handleDeleteCategory(id: string) {
    if (!confirm("このカテゴリを削除しますか？")) return;
    try {
      const res = await fetch(`/api/v1/categories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? "削除に失敗しました");
      }
      await fetchCategories();
    } catch (e) {
      setCatError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  const PRESET_COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
    "#DDA0DD", "#F0E68C", "#FFB347", "#98FB98", "#87CEEB",
  ];

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-bold text-gray-900">設定</h2>

      {/* タブ */}
      <div className="flex border-b border-gray-200">
        {(["accounts", "categories"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "accounts" ? "口座管理" : "カテゴリ管理"}
          </button>
        ))}
      </div>

      {/* ─── 口座管理タブ ─────────────────────────────────── */}
      {tab === "accounts" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">
              現金・クレカ・銀行口座を登録します
            </p>
            <button
              onClick={() => setShowAccForm(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + 口座を追加
            </button>
          </div>

          {accError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {accError}
            </div>
          )}

          {/* 追加フォーム */}
          {showAccForm && (
            <form
              onSubmit={handleAddAccount}
              className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    口座名 *
                  </label>
                  <input
                    type="text"
                    value={accForm.name}
                    onChange={(e) => setAccForm({ ...accForm, name: e.target.value })}
                    placeholder="現金、エポスカード..."
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    種別
                  </label>
                  <select
                    value={accForm.type}
                    onChange={(e) =>
                      setAccForm({ ...accForm, type: e.target.value as Account["type"] })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAccForm(false)}
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

          {accLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />
              ))}
            </div>
          ) : (
            <ul className="space-y-2">
              {accounts.map((acc) => (
                <li
                  key={acc.id}
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{acc.name}</p>
                    <p className="text-xs text-gray-500">
                      {ACCOUNT_TYPES.find((t) => t.value === acc.type)?.label ?? acc.type}
                      {" · "}{acc.currency}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteAccount(acc.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors text-sm"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ─── カテゴリ管理タブ ──────────────────────────────── */}
      {tab === "categories" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">
              カスタムカテゴリを追加できます。デフォルトカテゴリは削除できません。
            </p>
            <button
              onClick={() => setShowCatForm(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + カテゴリを追加
            </button>
          </div>

          {catError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {catError}
            </div>
          )}

          {/* 追加フォーム */}
          {showCatForm && (
            <form
              onSubmit={handleAddCategory}
              className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    カテゴリ名 *
                  </label>
                  <input
                    type="text"
                    value={catForm.name}
                    onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                    placeholder="ペット、旅行..."
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    種別
                  </label>
                  <select
                    value={catForm.type}
                    onChange={(e) =>
                      setCatForm({ ...catForm, type: e.target.value as "income" | "expense" })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="expense">支出</option>
                    <option value="income">収入</option>
                  </select>
                </div>
              </div>
              {/* カラー選択 */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  カラー
                </label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCatForm({ ...catForm, color })}
                      className={`h-7 w-7 rounded-full border-2 transition-transform ${
                        catForm.color === color
                          ? "border-gray-800 scale-110"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCatForm(false)}
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

          {catLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {(["expense", "income"] as const).map((type) => {
                const cats = categories.filter((c) => c.type === type);
                return (
                  <div key={type}>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      {type === "expense" ? "支出" : "収入"}
                    </h4>
                    <ul className="space-y-1">
                      {cats.map((cat) => (
                        <li
                          key={cat.id}
                          className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-2.5"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: cat.color ?? "#D3D3D3" }}
                            />
                            <span className="text-sm text-gray-900">{cat.name}</span>
                            {cat.is_default && (
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                                デフォルト
                              </span>
                            )}
                          </div>
                          {!cat.is_default && (
                            <button
                              onClick={() => handleDeleteCategory(cat.id)}
                              className="text-gray-300 hover:text-red-500 transition-colors text-sm"
                            >
                              削除
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
