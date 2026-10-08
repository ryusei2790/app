/**
 * @file lib/fixed-costs/schedule.ts
 * @description 定期支出・定期収入の支払日の計算（テスト一覧 R2・R3・R7・R9）。DB を使わない純粋関数。
 *
 * 日付はすべて "YYYY-MM-DD" の文字列で受け渡し、内部では UTC 0時の Date で計算する。
 * こうするとサーバーの TZ（Vercel = UTC、開発機 = JST）に関係なく同じ答えになる（lib/date/jst.ts と同じ考え方）。
 *
 * 周期ごとの支払日:
 *   - weekly   : start_date から 7日ごと（start_date の曜日）
 *   - biweekly : start_date から 14日ごと
 *   - monthly  : 毎月 billing_day 日。その月に無い日（31日など）は月末に丸める
 *   - yearly   : 毎年 billing_month 月 billing_day 日。2/29 は平年 2/28
 * どの周期も [start_date, end_date] の外は作らない。
 */

import { daysInMonth } from "@/lib/date/jst";

export type Cycle = "weekly" | "biweekly" | "monthly" | "yearly";
export const CYCLES: readonly Cycle[] = ["weekly", "biweekly", "monthly", "yearly"];

export interface ScheduleRule {
  cycle: Cycle;
  /** 1〜31。monthly・yearly で使う */
  billingDay: number | null;
  /** 1〜12。yearly で使う */
  billingMonth: number | null;
  startDate: string;
  endDate: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function ymd(year: number, month: number, day: number): string {
  return fromUtc(Date.UTC(year, month - 1, day));
}

/** 日付に n 日足す（負なら戻る） */
export function addDays(date: string, n: number): string {
  return fromUtc(toUtc(date) + n * DAY_MS);
}

/** その月の billing_day 日（月末を超えたら月末） */
function clampedDay(year: number, month: number, day: number): string {
  return ymd(year, month, Math.min(day, daysInMonth(year, month)));
}

/**
 * [from, to]（両端を含む）にある支払日を昇順で返す。
 * 開始日・終了日の外は含めない。from > to なら空。
 */
export function occurrencesBetween(rule: ScheduleRule, from: string, to: string): string[] {
  // 1. 範囲を開始日・終了日で狭める（文字列比較で日付の前後が判定できる形式）
  const lo = from > rule.startDate ? from : rule.startDate;
  const hi = rule.endDate !== null && rule.endDate < to ? rule.endDate : to;
  if (lo > hi) return [];

  const out: string[] = [];
  switch (rule.cycle) {
    case "weekly":
    case "biweekly": {
      // 2. 開始日から step 日ごと。lo 以上になる最初の回まで k を進めてから並べる
      const step = rule.cycle === "weekly" ? 7 : 14;
      const start = toUtc(rule.startDate);
      const k = Math.ceil((toUtc(lo) - start) / (step * DAY_MS));
      for (let t = start + Math.max(0, k) * step * DAY_MS; t <= toUtc(hi); t += step * DAY_MS) {
        out.push(fromUtc(t));
      }
      return out;
    }
    case "monthly": {
      // 3. lo の月から hi の月まで、各月の（丸めた）支払日が範囲内なら入れる
      const day = rule.billingDay ?? 1;
      let y = Number(lo.slice(0, 4));
      let m = Number(lo.slice(5, 7));
      const endKey = hi.slice(0, 7);
      while (`${y}-${String(m).padStart(2, "0")}` <= endKey) {
        const d = clampedDay(y, m, day);
        if (d >= lo && d <= hi) out.push(d);
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      return out;
    }
    case "yearly": {
      // 4. lo の年から hi の年まで、各年の支払月・日（丸め済み）が範囲内なら入れる
      const day = rule.billingDay ?? 1;
      const month = rule.billingMonth ?? 1;
      for (let y = Number(lo.slice(0, 4)); y <= Number(hi.slice(0, 4)); y++) {
        const d = clampedDay(y, month, day);
        if (d >= lo && d <= hi) out.push(d);
      }
      return out;
    }
  }
}

/**
 * onOrAfter 以降（当日を含む）で最初の支払日。終了日を過ぎていれば null。
 * 毎年払いでも最長1年強先を見れば必ず見つかるので、そこまでを探す。
 */
export function nextOccurrence(rule: ScheduleRule, onOrAfter: string): string | null {
  const from = onOrAfter > rule.startDate ? onOrAfter : rule.startDate;
  const found = occurrencesBetween(rule, from, addDays(from, 366));
  return found[0] ?? null;
}

/**
 * 月あたりの金額（円、四捨五入）。一覧の「月の固定費合計」に使う（R9）。
 * 毎週は年52回、隔週は年26回として12で割る。
 */
export function monthlyEquivalent(amount: number, cycle: Cycle): number {
  const perYear = { weekly: 52, biweekly: 26, monthly: 12, yearly: 1 }[cycle];
  return Math.round((amount * perYear) / 12);
}
