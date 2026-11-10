/**
 * @file lib/aggregate/forecast.ts
 * @description 今月の収支の「見込み込み」の数字（app#43）。純粋関数。
 *
 * 給料（25日）・家賃（月末）などの定期は、支払日になるまで取引にならない（lib/fixed-costs/expand.ts が支払日に作る）。
 * そのため月の途中では収入・支出が実際より少なく見える。ここでは「実績（summarize の数字）」に
 * 「定期のまだ取引になっていない今月の回（lib/fixed/upcoming.ts）」を足して、月の見込みを出す。
 *
 * 見込みは「この先、定期の展開が作る取引」そのもの。だから二重にならない条件も展開と同じにそろえる:
 *   1. 展開済みの回は数えない — upcoming は「展開済みの印（generated_through）の翌日以降」しか出さない
 *   2. 同じ定期・同じ日の自動の取引（source='auto'）が既にあれば数えない — 印を進める前に落ちた等の念のため
 *      （DB の一意索引も (fixed_cost_id, transaction_date) なので、同じ日に2件はできない）
 *   3. 定期の条件（メモの語句・カテゴリー・金額）に当てはまる手入力・CSV・レシートの取引が同じ期間にあれば数えない
 *      — upcoming の時点で外している（hasMatchingInPeriod。展開も同じ条件で作らない: F7）
 *
 * 見込みを足すのは「今月」だけ。過去の月は月末まで実績、先の月は全部が予定なので、数字は今までどおり（applies=false）。
 * 定期が無い・今月の回が全部取引になった月も applies=false（画面は従来どおり）。
 */

import type { MonthlySummary } from "./monthly";
import type { UpcomingItem } from "@/lib/fixed/upcoming";

export interface MonthForecast {
  /** 見込みを足したか。false なら下の数字は実績と同じ */
  applies: boolean;
  /** 実績＋定期の見込み */
  income: number;
  expense: number;
  balance: number;
  /** そのうち定期の見込みの分 */
  forecastIncome: number;
  forecastExpense: number;
  /** 見込みに入れた定期の回 */
  items: UpcomingItem[];
}

/** 二重計上の確認に使う取引の形（自動で作った取引の定期 ID と日付だけ見る） */
export interface ForecastTx {
  date: string;
  source: string;
  fixedCostId?: string | null;
}

/**
 * @param summary  その月の実績（summarize の結果）
 * @param upcoming その月の定期のまだ取引になっていない回（upcomingInMonth の結果）
 * @param txs      その月の取引（同じ定期・同じ日の自動の取引があるかを見る）
 */
export function forecastMonth(input: { summary: MonthlySummary; upcoming: UpcomingItem[]; txs: ForecastTx[] }): MonthForecast {
  const { summary, upcoming, txs } = input;
  const actual = { income: summary.income.total, expense: summary.expense.total, balance: summary.balance };
  const none: MonthForecast = { applies: false, ...actual, forecastIncome: 0, forecastExpense: 0, items: [] };
  if (summary.period.status !== "current") return none; // 過去月・先の月には足さない

  // 1. 同じ定期・同じ日の自動の取引が既にある回は外す（「定期 ID|日付」で引く）
  const generated = new Set(txs.filter((t) => t.source === "auto" && t.fixedCostId).map((t) => `${t.fixedCostId}|${t.date}`));
  const items = upcoming.filter((u) => !generated.has(`${u.fixedCostId}|${u.date}`));
  if (items.length === 0) return none;

  // 2. 収入・支出に分けて足す。定期の取引は種類が「購入・収入（normal）」なので、そのまま収入・支出に足せる
  const forecastIncome = items.filter((i) => i.type === "income").reduce((a, i) => a + i.amount, 0);
  const forecastExpense = items.filter((i) => i.type === "expense").reduce((a, i) => a + i.amount, 0);
  return {
    applies: true,
    income: actual.income + forecastIncome,
    expense: actual.expense + forecastExpense,
    balance: actual.balance + forecastIncome - forecastExpense,
    forecastIncome,
    forecastExpense,
    items,
  };
}
