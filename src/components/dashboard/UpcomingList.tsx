/**
 * @file components/dashboard/UpcomingList.tsx
 * @description 「予定（今日より後）」の一覧（mywork#229 の「今月の予定（未確定）」を mywork#425 第1弾で拡張）。
 * 2種類を日付順に並べる:
 *   - 定期のまだ取引になっていない回（仕送り 27日・給料 月末など）。支払日になると定期が取引を作る
 *   - 今日より後の日付で入れた取引（先払いなど）。日付が来ると実績に移る
 * どちらも合計には入れない。月末の見込み ＝ 今の残り ＋ 予定の収入 − 予定の支出。
 */

"use client";

import Link from "next/link";
import type { ScheduledItem, UpcomingItem } from "@/types/api";

function yen(amount: number): string {
  return `¥${Math.floor(Math.abs(amount)).toLocaleString("ja-JP")}`;
}

/** "2026-10-27" → "10/27" */
function shortDate(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

type Row = { key: string; date: string; name: string; type: "income" | "expense"; amount: number; from: "fixed" | "entry"; kind?: string };

export function UpcomingList({ items, scheduled = [], balance }: { items: UpcomingItem[]; scheduled?: ScheduledItem[]; balance: number }) {
  const rows: Row[] = [
    ...items.map((i): Row => ({ key: `fc-${i.fixed_cost_id}-${i.date}`, date: i.date, name: i.name, type: i.type, amount: i.amount, from: "fixed" })),
    ...scheduled.map((s): Row => ({ key: `tx-${s.id ?? s.date + s.name}`, date: s.date, name: s.name, type: s.type, amount: s.amount, from: "entry", kind: s.kind })),
  ].sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "ja") : a.date < b.date ? -1 : 1));
  if (rows.length === 0) return null;

  // 見込みに入れるのは購入・収入・返金だけ（振替・借入は残りを変えない）
  const counts = (type: "income" | "expense") =>
    rows.filter((r) => r.type === type && (r.kind === undefined || r.kind === "normal")).reduce((a, r) => a + r.amount, 0);
  const refunds = rows.filter((r) => r.kind === "refund").reduce((a, r) => a + r.amount, 0);
  const income = counts("income") - refunds; // 返金は収入ではなく支出の戻り
  const expense = counts("expense") - refunds;
  const projected = balance + counts("income") - refunds - counts("expense") + refunds;

  return (
    <section aria-label="予定" className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">予定（今日より後）</h3>
        <Link href="/fixed-costs" className="shrink-0 text-xs text-blue-600 hover:underline">
          定期の収入・支出 →
        </Link>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">日付になると収支に入ります。まだ合計には入っていません</p>

      <ul className="mt-3 divide-y divide-gray-200" data-testid="upcoming-list">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 truncate text-gray-700">
              <span className="mr-2 tabular-nums text-gray-500">{shortDate(r.date)}</span>
              {r.name}
              <span className="ml-2 rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500 ring-1 ring-gray-200">
                {r.from === "fixed" ? "定期" : r.kind === "refund" ? "返金" : r.kind === "transfer" ? "振替" : r.kind === "loan" ? "借入・返済" : "入力済み"}
              </span>
            </span>
            <span className={`shrink-0 tabular-nums ${r.type === "income" ? "text-green-700" : "text-gray-900"}`}>
              {r.type === "income" ? "+" : "-"}
              {yen(r.amount)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap justify-end gap-x-4 gap-y-1 border-t border-gray-200 pt-2 text-xs text-gray-600">
        {income > 0 && <span>予定の収入 +{yen(income)}</span>}
        {expense !== 0 && <span>予定の支出 -{yen(expense)}</span>}
        <span className="font-semibold text-gray-900" data-testid="projected-balance">
          月末の見込み {projected >= 0 ? "+" : "-"}
          {yen(projected)}
        </span>
      </div>
    </section>
  );
}
