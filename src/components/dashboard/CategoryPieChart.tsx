/**
 * @file components/dashboard/CategoryPieChart.tsx
 * @description カテゴリ別支出の円グラフ（Recharts）。
 * カテゴリごとの金額と構成比をドーナツグラフで可視化する。
 */

"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { CategorySummary } from "@/types/api";

interface CategoryPieChartProps {
  data: CategorySummary[];
}

/** 金額フォーマット */
function formatAmount(amount: number): string {
  return `¥${Math.floor(amount).toLocaleString("ja-JP")}`;
}

/** Recharts のカスタムツールチップ */
function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: CategorySummary }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg bg-white border border-gray-200 p-3 shadow-sm text-sm">
      <p className="font-medium text-gray-900">{item.name}</p>
      <p className="text-gray-600">{formatAmount(item.amount)}</p>
      <p className="text-gray-500">{Math.round(item.ratio * 100)}%</p>
    </div>
  );
}

export function CategoryPieChart({ data }: CategoryPieChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-400">
        データがありません
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 円グラフ */}
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}  // ドーナツ形状
            outerRadius={100}
            paddingAngle={2}
            dataKey="amount"
            nameKey="name"
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.category_id}
                fill={entry.color ?? `hsl(${(index * 47) % 360}, 65%, 55%)`}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => (
              <span className="text-xs text-gray-700">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* カテゴリ別一覧テーブル */}
      <ul className="space-y-2">
        {data.map((cat, index) => (
          <li key={cat.category_id} className="flex items-center gap-3">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{
                backgroundColor:
                  cat.color ?? `hsl(${(index * 47) % 360}, 65%, 55%)`,
              }}
            />
            <span className="flex-1 text-sm text-gray-700">{cat.name}</span>
            <span className="text-xs text-gray-500">
              {Math.round(cat.ratio * 100)}%
            </span>
            <span className="text-sm font-medium text-gray-900 w-24 text-right">
              {formatAmount(cat.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
