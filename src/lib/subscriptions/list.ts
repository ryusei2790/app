/**
 * @file lib/subscriptions/list.ts
 * @description サブスク一覧（/subscriptions、mywork#742 ②）の並びと合計を決める純粋関数。
 * 設計書 docs/2026-10-23_サブスク管理_設計.md §2・§3-1。
 *
 * - 入力は GET /api/v1/fixed-costs の1件（snake_case）そのもの。API を増やさず、画面側でサブスクの分だけ選ぶ
 * - 次回更新日: 手入力（next_renewal_date）が今日以降ならそれ、過ぎた・空なら支払日の規則からの次の支払日（next_date）。
 *   止めている・終わったものは無し（一覧の最後にグレーで出す）
 * - 合計: 動いているサブスクの「月あたりの円」（monthlyEquivalent）。ドル建ては API が付けた今日のドル円の目安 amount_yen。
 *   相場が取れなかったドル建ては合計から外し、その件数を missing_rate で返す（定期の画面と同じ扱い）
 * 日付は "YYYY-MM-DD" の文字列で比べる（端末の TZ に左右されない）。
 */

import { monthlyEquivalent, type Cycle } from "@/lib/fixed-costs/schedule";

/** 更新が近いとみなす日数（設計 Q4 A: 一覧で7日以内を色付け） */
export const SOON_DAYS = 7;

/** 一覧の材料（GET /api/v1/fixed-costs の1件のうち使う項目） */
export interface SubscriptionSource {
  id: string;
  name: string;
  amount: number;
  currency: "JPY" | "USD";
  /** 円での金額。ドル建ては今日のドル円での目安（相場が取れなければ null） */
  amount_yen: number | null;
  cycle: Cycle;
  is_active: boolean;
  is_subscription: boolean;
  /** 支払日の規則からの次の支払日（止めている・終わったものは null） */
  next_date: string | null;
  /** 手入力の次回更新日 */
  next_renewal_date: string | null;
}

export type SubscriptionRow<T extends SubscriptionSource = SubscriptionSource> = T & {
  /** 次回更新日（無ければ null） */
  renewal: string | null;
  /** 手入力の日か */
  manual: boolean;
  /** 今日から次回更新日までの日数 */
  days_left: number | null;
  /** SOON_DAYS 以内か */
  soon: boolean;
};

export interface SubscriptionList<T extends SubscriptionSource = SubscriptionSource> {
  /** 動いているもの（次回更新日の昇順） */
  active: SubscriptionRow<T>[];
  /** 止めている・終わったもの（合計に入れない） */
  stopped: SubscriptionRow<T>[];
  /** 動いているものの月あたりの円 */
  monthly_total: number;
  /** 年あたり＝月×12（設計 §3-1） */
  yearly_total: number;
  /** 動いているものの件数（相場なしのドル建ても数える） */
  count: number;
  /** 相場が取れず合計に入っていないドル建ての件数 */
  missing_rate: number;
}

/** "YYYY-MM-DD" 同士の日数の差（to − from）。UTC の0時同士で引くので夏時間・TZ に左右されない */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * 次回更新日を決める（設計 §2 の流れ図）。
 * なぜ手入力が過ぎたら自動に戻すか: 年払いの更新日を入れ直し忘れても、古い日付が「次回」として残らないように。
 */
export function renewalOf(s: SubscriptionSource, today: string): { date: string | null; manual: boolean } {
  if (!s.is_active) return { date: null, manual: false };
  if (s.next_renewal_date !== null && s.next_renewal_date >= today) return { date: s.next_renewal_date, manual: true };
  return { date: s.next_date, manual: false };
}

/**
 * サブスクの分だけ選び、動いているもの（次回更新日の昇順）と止めているものに分け、合計を出す。
 * 同じ日なら元の並び（API の並び）を保つ（Array.prototype.sort は安定ソート）。
 */
export function buildSubscriptionList<T extends SubscriptionSource>(items: T[], today: string): SubscriptionList<T> {
  const rows: SubscriptionRow<T>[] = items
    .filter((s) => s.is_subscription)
    .map((s) => {
      const { date, manual } = renewalOf(s, today);
      const days = date === null ? null : daysBetween(today, date);
      return { ...s, renewal: date, manual, days_left: days, soon: days !== null && days <= SOON_DAYS };
    });

  // 1. 次回更新日が無いもの（止めている・終わった）は「止めているもの」へ
  const active = rows.filter((r) => r.renewal !== null).sort((a, b) => (a.renewal! < b.renewal! ? -1 : a.renewal! > b.renewal! ? 1 : 0));
  const stopped = rows.filter((r) => r.renewal === null);

  // 2. 合計は動いているものだけ。円にできないドル建ては外して数を返す
  let monthly = 0;
  let missing = 0;
  for (const r of active) {
    if (r.amount_yen === null) missing++;
    else monthly += monthlyEquivalent(r.amount_yen, r.cycle);
  }

  return { active, stopped, monthly_total: monthly, yearly_total: monthly * 12, count: active.length, missing_rate: missing };
}
