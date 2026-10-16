/**
 * @file lib/fixed/upcoming.ts
 * @description ダッシュボードの「今月の予定（未確定）」（mywork#229、10月の収入の見せ方 A）。純粋関数。
 *
 * 未来の日付の取引は入れない（予定は実績ではない）。代わりに、有効な定期のうち
 * まだ取引になっていない回（展開済みの印の翌日以降、かつ今日以降）を、見ている月の月末まで並べる。
 * その回の取引は、支払日になると定期の展開（lib/fixed-costs/expand.ts）が作る。
 * その月に条件に当てはまる手入力・CSV の取引が既にあれば出さない（同じ収入を二重に見込まない）。
 */

import { daysInMonth } from "@/lib/date/jst";
import { addDays, occurrencesBetween, type Cycle } from "@/lib/fixed-costs/schedule";
import { hasMatchingInPeriod, type FixedCondition, type FixedTx } from "./classify";

export interface UpcomingSource extends FixedCondition {
  name: string;
  cycle: Cycle;
  billingDay: number | null;
  billingMonth: number | null;
  /** "YYYY-MM-DD" */
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  /** この日まで取引にした（null = まだ一度も） */
  generatedThrough: string | null;
}

export interface UpcomingItem {
  fixedCostId: string;
  date: string;
  name: string;
  type: "income" | "expense";
  amount: number;
}

/**
 * @param month "YYYY-MM"（見ている月）
 * @param today JST の今日 "YYYY-MM-DD"
 * @param txs   見ている月の取引（二重に見込まないための確認用）
 */
export function upcomingInMonth(input: {
  sources: UpcomingSource[];
  txs: FixedTx[];
  month: string;
  today: string;
}): UpcomingItem[] {
  const { sources, txs, month, today } = input;
  const [y, m] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  if (monthEnd < today) return []; // 過ぎた月に予定は無い

  const items: UpcomingItem[] = [];
  for (const s of sources) {
    if (!s.isActive) continue;
    // 1. 探し始め = 今日・展開済みの翌日・月初 の一番遅い日
    const afterDone = s.generatedThrough ? addDays(s.generatedThrough, 1) : today;
    const from = [today, afterDone, monthStart].sort().at(-1)!;
    // 2. 月末までの回。その月に当てはまる取引が先にあれば見込まない
    for (const date of occurrencesBetween(s, from, monthEnd)) {
      if (hasMatchingInPeriod(txs, s, date, s.cycle)) continue;
      items.push({ fixedCostId: s.id, date, name: s.name, type: s.type, amount: s.amount });
    }
  }
  return items.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "ja") : a.date < b.date ? -1 : 1));
}
