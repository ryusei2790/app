/**
 * @file components/budget/BudgetView.tsx
 * @description 予算台帳の画面（社長専用・Client Component。テスト一覧 W8）。スマホ幅で上から順に:
 *   1. 月の切り替え
 *   2. 食費カード（上限までの残り・目標までの残り・1日目安）… 毎日見る数字なので一番上
 *   3. 8費目の 実績／枠 のバー（超えたら赤）と合計 6万円との差
 *   4. 未割り当て・枠の外・収入
 *   5. 直近12か月の推移（費目の積み上げ棒＋枠の線）
 *   6. 対応表（カテゴリー → 費目）と枠の金額の編集（RuleEditor）
 * 数字はすべて /api/v1/budget が返す（振り分け・集計はサーバーの lib/budget/*）。
 */

"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RuleEditor, type RuleRow } from "./RuleEditor";

interface FrameResult {
  id: string;
  name: string;
  limit: number;
  target: number | null;
  spent: number;
  remaining: number;
}

export interface BudgetData {
  month: string;
  today: string;
  summary: {
    frames: FrameResult[];
    total: { limit: number; spent: number; remaining: number };
    outside: number;
    income: number;
    unassigned: { count: number; amount: number; categories: string[] };
    food: {
      limit: number;
      target: number | null;
      spent: number;
      remainingToLimit: number;
      remainingToTarget: number | null;
      daysLeft: number;
      perDay: number | null;
      perDayTarget: number | null;
    } | null;
  };
  trend: Array<{ month: string; byFrame: Record<string, number>; total: number; income: number }>;
  frames: Array<{ id: string; name: string; monthly_limit: number; target: number | null; sort_order: number }>;
  rules: RuleRow[];
}

/** 費目の色。検証済みの8色を費目の並び順で固定して使う（並びが同じなら色も同じ。順位で塗り替えない） */
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const monthLabel = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;

export function BudgetView({ initialMonth }: { initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth ?? "");
  const [data, setData] = useState<BudgetData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 読み直しの合図（対応表・枠を直したら +1）
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/budget${month ? `?month=${month}` : ""}`);
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
    // 月を素早く切り替えたとき、古い月の結果で上書きしない
    return () => {
      cancelled = true;
    };
  }, [month, reload]);

  if (error) return <div className="p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="p-4 text-sm text-gray-500">読み込み中…</div>;

  const { summary } = data;
  const food = summary.food;
  const chartData = data.trend.map((t) => ({ month: t.month.slice(2).replace("-", "/"), ...t.byFrame, total: t.total }));

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">予算</h1>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span>月</span>
          <input
            type="month"
            aria-label="月"
            value={data.month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      {/* 食費カード */}
      {food && (
        <section data-testid="food-card" className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">食費（自炊）{monthLabel(data.month)}</h2>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500">1日目安（上限まで）</p>
              <p className="text-2xl font-bold text-gray-900">{food.perDay === null ? "—" : yen(food.perDay)}</p>
              <p className="text-xs text-gray-500">{food.daysLeft > 0 ? `残り${food.daysLeft}日（今日を含む）` : "この月は終わりました"}</p>
            </div>
            <div className="space-y-1 text-sm">
              <p>
                使った <span className="font-medium">{yen(food.spent)}</span>
              </p>
              <p className={food.remainingToLimit < 0 ? "text-red-700" : ""}>
                上限 {yen(food.limit)} まで {food.remainingToLimit < 0 ? `${yen(-food.remainingToLimit)} 超過` : `あと ${yen(food.remainingToLimit)}`}
              </p>
              {food.target !== null && food.remainingToTarget !== null && (
                <p className={food.remainingToTarget < 0 ? "text-amber-700" : ""}>
                  目標 {yen(food.target)} まで{" "}
                  {food.remainingToTarget < 0 ? `${yen(-food.remainingToTarget)} 超過` : `あと ${yen(food.remainingToTarget)}`}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 8費目 */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-gray-800">費目ごとの実績</h2>
          <p className={`text-sm ${summary.total.remaining < 0 ? "text-red-700" : "text-gray-700"}`}>
            合計 {yen(summary.total.spent)} / {yen(summary.total.limit)}
          </p>
        </div>
        <ul className="mt-3 space-y-3">
          {summary.frames.map((f) => {
            const over = f.remaining < 0;
            const pct = f.limit > 0 ? Math.min(100, (f.spent / f.limit) * 100) : f.spent > 0 ? 100 : 0;
            return (
              <li key={f.id} data-testid={`frame-${f.name}`}>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-800">{f.name}</span>
                  <span className={over ? "font-medium text-red-700" : "text-gray-700"}>
                    {yen(f.spent)} / {yen(f.limit)}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100" role="presentation">
                  <div className={`h-2 rounded-full ${over ? "bg-red-600" : "bg-blue-600"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className={`mt-0.5 text-xs ${over ? "text-red-700" : "text-gray-500"}`}>
                  {over ? `⚠ ${yen(-f.remaining)} 超過` : `残り ${yen(f.remaining)}`}
                </p>
              </li>
            );
          })}
        </ul>
        {summary.total.remaining < 0 && (
          <p className="mt-3 text-sm text-red-700">⚠ 合計が枠を {yen(-summary.total.remaining)} 超えています</p>
        )}
      </section>

      {/* 未割り当て・枠の外・収入 */}
      <section className="space-y-1 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
        {summary.unassigned.count > 0 && (
          <p data-testid="unassigned" className="text-amber-800">
            ⚠ 対応表に無いカテゴリー: {summary.unassigned.categories.join("・")}（{summary.unassigned.count}件 {yen(summary.unassigned.amount)}）→ 下の対応表で費目を選んでください
          </p>
        )}
        <p>枠の外（家賃・事業など）: {yen(summary.outside)}</p>
        <p>収入: {yen(summary.income)}</p>
      </section>

      {/* 推移 */}
      <section data-testid="trend-chart" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">月ごとの推移（枠の中・直近12か月）</h2>
        <p className="text-xs text-gray-500">点線は枠の合計 {yen(summary.total.limit)}。棒を押すとその月を表示します。</p>
        <div className="mt-2 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 4, left: -12, bottom: 0 }}
              onClick={(e) => {
                const idx = typeof e?.activeTooltipIndex === "number" ? e.activeTooltipIndex : Number(e?.activeTooltipIndex);
                const m = Number.isInteger(idx) ? data.trend[idx]?.month : undefined;
                if (m) setMonth(m);
              }}
            >
              <CartesianGrid vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v / 1000}k`} />
              <Tooltip
                formatter={(v, name) => [yen(Number(v)), String(name)]}
                contentStyle={{ fontSize: 12 }}
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#374151" }} iconSize={8} />
              <ReferenceLine y={summary.total.limit} stroke="#6b7280" strokeDasharray="4 4" />
              {summary.frames.map((f, i) => (
                <Bar
                  key={f.id}
                  dataKey={f.id}
                  name={f.name}
                  stackId="spend"
                  fill={SERIES[i % SERIES.length]}
                  stroke="#ffffff"
                  strokeWidth={1}
                  radius={i === summary.frames.length - 1 ? [4, 4, 0, 0] : 0}
                  cursor="pointer"
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* 表でも見られるように（色だけに頼らない） */}
        <details className="mt-2 text-xs text-gray-600">
          <summary className="cursor-pointer">表で見る</summary>
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 font-normal">月</th>
                <th className="py-1 text-right font-normal">枠の中</th>
                <th className="py-1 text-right font-normal">収入</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((t) => (
                <tr key={t.month} className="border-t border-gray-100">
                  <td className="py-1">{t.month}</td>
                  <td className="py-1 text-right">{yen(t.total)}</td>
                  <td className="py-1 text-right">{yen(t.income)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {/* 対応表と枠 */}
      <RuleEditor data={data} onChanged={() => setReload((n) => n + 1)} />
    </div>
  );
}
