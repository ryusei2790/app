/**
 * @file components/dashboard/FixedBreakdown.tsx
 * @description 月の収支の「固定の収入／固定の支出／変動の支出」（mywork#229 F8）。
 * 固定＝定期の条件に当てはまる取引（給料・仕送り・家賃・サブスクなど）、変動＝それ以外（食費・外食・交通費…）。
 * 変動の収入（臨時の収入）は 0 円のときは出さない（多くの月は無いので、3枚に絞ってスマホで読みやすくする）。
 */

"use client";

import type { DashboardSummary } from "@/types/api";

function yen(amount: number): string {
  return `¥${Math.floor(Math.abs(amount)).toLocaleString("ja-JP")}`;
}

export function FixedBreakdown({ fixed }: { fixed: DashboardSummary["fixed"] }) {
  const cell = "rounded-xl border p-3";
  const value = "mt-1 whitespace-nowrap text-base font-bold tabular-nums sm:text-xl";
  return (
    <section aria-label="固定と変動" className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className={`${cell} border-green-100 bg-white`}>
          <p className="text-xs font-medium text-green-600">固定の収入</p>
          <p className={`${value} text-green-700`} data-testid="fixed-income">+{yen(fixed.fixed_income)}</p>
        </div>
        <div className={`${cell} border-purple-100 bg-white`}>
          <p className="text-xs font-medium text-purple-600">固定の支出</p>
          <p className={`${value} text-purple-700`} data-testid="fixed-expense">-{yen(fixed.fixed_expense)}</p>
        </div>
        <div className={`${cell} border-red-100 bg-white`}>
          <p className="text-xs font-medium text-red-600">変動の支出</p>
          <p className={`${value} text-red-700`} data-testid="variable-expense">-{yen(fixed.variable_expense)}</p>
        </div>
      </div>
      {fixed.variable_income > 0 && (
        <p className="text-xs text-gray-500">ほかに臨時の収入 +{yen(fixed.variable_income)}</p>
      )}
    </section>
  );
}
