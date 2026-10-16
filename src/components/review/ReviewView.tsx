/**
 * @file components/review/ReviewView.tsx
 * @description 「要確認」の画面（Client Component。mywork#425 第1弾、設計書 4-6、テスト一覧 W12）。
 * GET /api/v1/review が挙げた候補を、その場で直せる形で並べる:
 *   - 返金候補   … 「返金にする」（PUT kind=refund）。収入ではなく同じカテゴリーの支出から引かれる
 *   - 未割り当て … カテゴリーを選ぶ（PUT category_id）
 *   - 重複候補   … 片方を消す（DELETE。2段階のボタンで誤操作を防ぐ。confirm() は使わない）
 *   - 予定       … 今日より後の行。合計に入っていないことを示すだけ
 * 直すのは本人。ここでは候補を挙げるだけで、勝手に変えない。
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCategories } from "@/hooks/useCategories";
import { currentMonthKey, shiftMonthKey } from "@/hooks/useDashboardSummary";
import { DEFINITIONS_PATH, FOOTNOTES, kindLabel, type TransactionKind } from "@/lib/aggregate/definitions";

interface Item {
  id: string;
  date: string;
  amount: number;
  type: "income" | "expense";
  kind: TransactionKind;
  category_id: string | null;
  category_name: string | null;
  note: string | null;
  source: string;
  reason: string;
}

interface ReviewData {
  month: string;
  today: string;
  refund_candidates: Item[];
  unassigned: Item[];
  scheduled: Item[];
  duplicates: Array<{ key: string; items: Item[] }>;
}

const yen = (n: number) => `¥${Math.floor(Math.abs(n)).toLocaleString("ja-JP")}`;
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function ItemLine({ item }: { item: Item }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm text-gray-900">
          <span className="mr-2 tabular-nums text-gray-500">{shortDate(item.date)}</span>
          {item.note ?? item.category_name ?? "未分類"}
        </p>
        <p className="text-xs text-gray-500">
          {item.category_name ?? "カテゴリーなし"} · {kindLabel(item.kind, item.type)}
        </p>
      </div>
      <span className={`shrink-0 tabular-nums text-sm font-medium ${item.type === "income" ? "text-green-700" : "text-gray-900"}`}>
        {item.type === "income" ? "+" : "-"}
        {yen(item.amount)}
      </span>
    </div>
  );
}

export function ReviewView({ initialMonth }: { initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth ?? currentMonthKey());
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // 読み直しの合図（直したら +1）。月を素早く切り替えたとき、古い月の結果で上書きしない
  const [reload, setReload] = useState(0);
  const { categories } = useCategories("expense");
  const [y, m] = month.split("-").map(Number);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/review?month=${month}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? "読み込みに失敗しました");
        if (!cancelled) {
          setData(json.data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, reload]);

  const load = () => setReload((n) => n + 1);

  async function update(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      const res = await fetch(`/api/v1/transactions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? "変更に失敗しました");
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "変更に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/v1/transactions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("削除に失敗しました");
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  const total = data ? data.refund_candidates.length + data.unassigned.length + data.duplicates.length : 0;
  const card = "rounded-xl border border-gray-200 bg-white p-3 sm:p-4";
  const btn = "rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50";

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <button onClick={() => setMonth(shiftMonthKey(month, -1))} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50">
          ← 前月
        </button>
        <h1 className="text-lg font-bold text-gray-900 sm:text-xl">
          {y}年{m}月 要確認
        </h1>
        <button onClick={() => setMonth(shiftMonthKey(month, 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50">
          翌月 →
        </button>
      </div>
      <p className="text-sm text-gray-600">
        機械的に挙げた候補です。直すかどうかは確かめてから決めてください。数字の意味は{" "}
        <Link href={DEFINITIONS_PATH} className="text-blue-600 hover:underline">
          定義
        </Link>
        {" "}を見てください。
      </p>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!data ? (
        <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
      ) : (
        <>
          {total === 0 && data.scheduled.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500" data-testid="review-empty">
              要確認はありません
            </div>
          )}

          {/* 返金候補 */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-800">
              返金候補 <span className="tabular-nums text-gray-500">{data.refund_candidates.length}件</span>
            </h2>
            <p className="text-xs text-gray-500">返金にすると、収入ではなく同じカテゴリーの支出から引かれます（支出＝購入−返金）</p>
            {data.refund_candidates.map((item) => (
              <div key={item.id} className={card} data-testid="refund-candidate">
                <ItemLine item={item} />
                <p className="mt-2 text-xs text-amber-700">{item.reason}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => update(item.id, { kind: "refund" })}
                    className={`${btn} bg-teal-600 text-white hover:bg-teal-700`}
                  >
                    返金にする
                  </button>
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => update(item.id, { kind: "transfer" })}
                    className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}
                  >
                    振替にする
                  </button>
                </div>
              </div>
            ))}
          </section>

          {/* 未割り当て */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-800">
              カテゴリーなし <span className="tabular-nums text-gray-500">{data.unassigned.length}件</span>
            </h2>
            {data.unassigned.map((item) => (
              <div key={item.id} className={card} data-testid="unassigned-item">
                <ItemLine item={item} />
                <p className="mt-2 text-xs text-amber-700">{item.reason}</p>
                <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                  カテゴリーを選ぶ
                  <select
                    aria-label="カテゴリーを選ぶ"
                    disabled={busy === item.id}
                    defaultValue=""
                    onChange={(e) => e.target.value && update(item.id, { category_id: e.target.value })}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    <option value="">選択…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </section>

          {/* 重複候補 */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-800">
              重複候補 <span className="tabular-nums text-gray-500">{data.duplicates.length}組</span>
            </h2>
            <p className="text-xs text-gray-500">同じ日に同じ買い物を2回することもあります。本当に二重なら片方を消してください</p>
            {data.duplicates.map((g) => (
              <div key={g.key} className={`${card} space-y-2`} data-testid="duplicate-group">
                {g.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <ItemLine item={item} />
                    </div>
                    {confirmDelete === item.id ? (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" disabled={busy === item.id} onClick={() => remove(item.id)} className={`${btn} bg-red-600 text-white`}>
                          本当に消す
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(null)} className={`${btn} border border-gray-300 text-gray-700`}>
                          やめる
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(item.id)} className={`${btn} shrink-0 border border-gray-300 text-gray-700`}>
                        この行を消す
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </section>

          {/* 予定 */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-800">
              予定（今日より後） <span className="tabular-nums text-gray-500">{data.scheduled.length}件</span>
            </h2>
            <p className="text-xs text-gray-500">{FOOTNOTES.scheduledShort}</p>
            {data.scheduled.map((item) => (
              <div key={item.id} className={card} data-testid="scheduled-item">
                <ItemLine item={item} />
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
