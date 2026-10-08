/**
 * @file components/fixed-costs/FixedCostView.tsx
 * @description 定期支出・定期収入の管理画面（Client Component。テスト一覧 C・W5）。
 * 一覧（次回の支払日順）・月あたりの支出／収入合計・追加・編集・一時停止・削除を行う。
 * 追加・編集の後は /api/v1/fixed-costs/generate を呼び、今日までの分をすぐ取引にする
 * （毎日の定期実行を待たずにカレンダーへ出すため）。
 * スマホ幅（375px）で1列、広い画面で2列のフォームにする。
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";

type Cycle = "weekly" | "biweekly" | "monthly" | "yearly";
type Kind = "expense" | "income";

interface FixedCost {
  id: string;
  name: string;
  amount: number;
  type: Kind;
  cycle: Cycle;
  billing_day: number | null;
  billing_month: number | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  next_date: string | null;
  account_id: string;
  category_id: string | null;
  account: { id: string; name: string } | null;
  category: { id: string; name: string; color: string | null } | null;
}

interface Totals {
  monthly_expense_total: number;
  monthly_income_total: number;
}

const CYCLE_LABEL: Record<Cycle, string> = {
  weekly: "毎週",
  biweekly: "隔週",
  monthly: "毎月",
  yearly: "毎年",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatAmount(amount: number): string {
  return `¥${Math.floor(amount).toLocaleString("ja-JP")}`;
}

/** 一覧の「いつ払うか」の説明（例: 毎月25日 / 毎週木曜 / 毎年4月1日） */
function describeSchedule(fc: FixedCost): string {
  switch (fc.cycle) {
    case "weekly":
    case "biweekly": {
      const wd = WEEKDAYS[new Date(`${fc.start_date}T00:00:00Z`).getUTCDay()];
      return `${CYCLE_LABEL[fc.cycle]}${wd}曜`;
    }
    case "monthly":
      return `毎月${fc.billing_day}日`;
    case "yearly":
      return `毎年${fc.billing_month}月${fc.billing_day}日`;
  }
}

/** "2026-10-25" → "10/25" */
function shortDate(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

function todayLocal(): string {
  // 画面の既定値用。ブラウザは日本で使う前提なので端末の日付でよい（サーバー側は JST で計算し直す）
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

const emptyForm = () => ({
  type: "expense" as Kind,
  name: "",
  amount: "",
  cycle: "monthly" as Cycle,
  billing_day: "1",
  billing_month: "1",
  start_date: todayLocal(),
  end_date: "",
  account_id: "",
  category_id: "",
});

type FormState = ReturnType<typeof emptyForm>;

export function FixedCostView() {
  const { accounts } = useAccounts();
  const [form, setForm] = useState<FormState>(emptyForm);
  const { categories } = useCategories(form.type);

  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [totals, setTotals] = useState<Totals>({ monthly_expense_total: 0, monthly_income_total: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 一覧の再読み込みは reload を進めて effect に任せる（effect の中で同期的に setState しない）
  const [reload, setReload] = useState(0);
  const fetchFixedCosts = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/fixed-costs")
      .then(async (res) => {
        if (!res.ok) throw new Error("定期支出の取得に失敗しました");
        const json = await res.json();
        if (!alive) return;
        setFixedCosts(json.data);
        setTotals(json.meta);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "不明なエラー"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reload]);

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEdit(fc: FixedCost) {
    setEditingId(fc.id);
    setForm({
      type: fc.type,
      name: fc.name,
      amount: String(fc.amount),
      cycle: fc.cycle,
      billing_day: String(fc.billing_day ?? 1),
      billing_month: String(fc.billing_month ?? 1),
      start_date: fc.start_date,
      end_date: fc.end_date ?? "",
      account_id: fc.account_id,
      category_id: fc.category_id ?? "",
    });
    setShowForm(true);
  }

  /** 追加・編集の送信。周期に関係ない項目は送らない（サーバーでも捨てる） */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name || !form.amount || !form.account_id) {
      setError("名前・金額・口座は必須です");
      return;
    }
    const usesDay = form.cycle === "monthly" || form.cycle === "yearly";
    const body = {
      type: form.type,
      name: form.name,
      amount: Number(form.amount),
      cycle: form.cycle,
      billing_day: usesDay ? Number(form.billing_day) : null,
      billing_month: form.cycle === "yearly" ? Number(form.billing_month) : null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      account_id: form.account_id,
      category_id: form.category_id || null,
    };
    try {
      const res = await fetch(editingId ? `/api/v1/fixed-costs/${editingId}` : "/api/v1/fixed-costs", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? "保存に失敗しました");
      }
      setShowForm(false);
      setEditingId(null);
      // 今日までの支払日があればすぐ取引にする
      await fetch("/api/v1/fixed-costs/generate", { method: "POST" }).catch(() => undefined);
      fetchFixedCosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  /** 一時停止／再開 */
  async function toggleActive(fc: FixedCost) {
    try {
      const res = await fetch(`/api/v1/fixed-costs/${fc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !fc.is_active }),
      });
      if (!res.ok) throw new Error("更新に失敗しました");
      fetchFixedCosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  /** 削除（作成済みの取引は残る） */
  async function handleDelete(fc: FixedCost) {
    if (!confirm(`「${fc.name}」を削除しますか？（これまでの取引は残ります）`)) return;
    try {
      const res = await fetch(`/api/v1/fixed-costs/${fc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("削除に失敗しました");
      fetchFixedCosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    }
  }

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const label = "block text-xs font-medium text-gray-700 mb-1";

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">定期支出</h2>
          <p className="text-sm text-gray-500 mt-0.5">支払日になると自動で収支に追加されます</p>
        </div>
        <button
          onClick={openAdd}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + 追加
        </button>
      </div>

      {/* 月あたりの合計（止めているものは入れない） */}
      {!loading && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-purple-50 border border-purple-100 px-4 py-3">
            <p className="text-xs font-medium text-purple-600">月あたりの定期支出</p>
            <p className="mt-1 text-xl font-bold text-purple-700" data-testid="monthly-expense-total">
              {formatAmount(totals.monthly_expense_total)}
            </p>
          </div>
          <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-3">
            <p className="text-xs font-medium text-green-600">月あたりの定期収入</p>
            <p className="mt-1 text-xl font-bold text-green-700">{formatAmount(totals.monthly_income_total)}</p>
          </div>
        </div>
      )}

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}

      {/* 追加・編集フォーム */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-blue-800">{editingId ? "定期を編集" : "定期を追加"}</h3>
          {editingId && (
            <p className="text-xs text-blue-700">変更はこれからの回にだけ反映されます（作成済みの取引はそのまま）。</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fc-type" className={label}>種別</label>
              <select
                id="fc-type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as Kind, category_id: "" })}
                className={input}
              >
                <option value="expense">支出</option>
                <option value="income">収入</option>
              </select>
            </div>
            <div>
              <label htmlFor="fc-name" className={label}>名前 *</label>
              <input
                id="fc-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="家賃、Netflix、給料…"
                className={input}
              />
            </div>
            <div>
              <label htmlFor="fc-amount" className={label}>金額（円）*</label>
              <input
                id="fc-amount"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="980"
                className={input}
              />
            </div>
            <div>
              <label htmlFor="fc-cycle" className={label}>周期</label>
              <select
                id="fc-cycle"
                value={form.cycle}
                onChange={(e) => setForm({ ...form, cycle: e.target.value as Cycle })}
                className={input}
              >
                {(Object.keys(CYCLE_LABEL) as Cycle[]).map((c) => (
                  <option key={c} value={c}>{CYCLE_LABEL[c]}</option>
                ))}
              </select>
            </div>
            {form.cycle === "yearly" && (
              <div>
                <label htmlFor="fc-month" className={label}>支払月</label>
                <select
                  id="fc-month"
                  value={form.billing_month}
                  onChange={(e) => setForm({ ...form, billing_month: e.target.value })}
                  className={input}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}月</option>
                  ))}
                </select>
              </div>
            )}
            {(form.cycle === "monthly" || form.cycle === "yearly") && (
              <div>
                <label htmlFor="fc-day" className={label}>支払日（その月に無い日は月末）</label>
                <select
                  id="fc-day"
                  value={form.billing_day}
                  onChange={(e) => setForm({ ...form, billing_day: e.target.value })}
                  className={input}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}日</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="fc-start" className={label}>
                開始日{form.cycle === "weekly" || form.cycle === "biweekly" ? "（この曜日に払う）" : ""}
              </label>
              <input
                id="fc-start"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label htmlFor="fc-end" className={label}>終了日（任意）</label>
              <input
                id="fc-end"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label htmlFor="fc-account" className={label}>口座 *</label>
              <select
                id="fc-account"
                value={form.account_id}
                onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                className={input}
              >
                <option value="">選択</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fc-category" className={label}>カテゴリ</label>
              <select
                id="fc-category"
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                className={input}
              >
                <option value="">未分類</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
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
            <button type="submit" className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700">
              保存
            </button>
          </div>
        </form>
      )}

      {/* 一覧（次回の支払日順。止めているものは最後） */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : fixedCosts.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">定期支出が登録されていません</div>
      ) : (
        <ul className="space-y-3" aria-label="定期支出の一覧">
          {fixedCosts.map((fc) => (
            <li
              key={fc.id}
              data-testid="fixed-cost-item"
              className={`rounded-xl border p-4 transition-opacity ${
                fc.is_active ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className="mt-1 h-4 w-4 rounded-full shrink-0"
                    style={{ backgroundColor: fc.category?.color ?? "#D3D3D3" }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {fc.type === "income" && <span className="mr-1 text-green-600">[収入]</span>}
                      {fc.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {describeSchedule(fc)} · {fc.account?.name}
                      {fc.category && ` · ${fc.category.name}`}
                    </p>
                    <p className="text-xs text-gray-500" data-testid="next-date">
                      {fc.is_active ? (fc.next_date ? `次回 ${shortDate(fc.next_date)}` : "終了") : "停止中"}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 text-sm font-medium ${fc.type === "income" ? "text-green-700" : "text-gray-900"}`}>
                  {formatAmount(Number(fc.amount))}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-end gap-4 text-xs">
                <button type="button" onClick={() => openEdit(fc)} className="text-blue-600 hover:underline">
                  編集
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={fc.is_active}
                  aria-label={`${fc.name}を${fc.is_active ? "一時停止" : "再開"}`}
                  onClick={() => toggleActive(fc)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    fc.is_active ? "bg-blue-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      fc.is_active ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(fc)}
                  className="text-gray-400 hover:text-red-500"
                  aria-label={`${fc.name}を削除`}
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
