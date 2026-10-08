/**
 * @file lib/date/jst.ts
 * @description 日付の扱いを日本時間（JST, UTC+9）に揃える部品（テスト一覧 T3）。
 *
 * なぜ必要か:
 *   `new Date(year, month - 1, 1)` はサーバーのローカル TZ で解釈される。Vercel は UTC、
 *   開発機は JST なので、同じコードでも月の範囲が1日ずれる（JST だと前月末が入り、月末が抜ける）。
 *   取引日は DB の date 列（時刻なし）なので、「YYYY-MM-DD を UTC 0時の Date」として扱えば
 *   どの TZ のサーバーでも同じ結果になる。
 *
 * - toJstDateString: ある瞬間（レシートの時刻・現在時刻など）を JST の日付文字列にする
 * - monthRange:      ある年月の [1日, 翌月1日) を date 列用の Date で返す
 * - dateOnlyToDb:    "YYYY-MM-DD" を date 列用の Date（UTC 0時）にする
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 瞬間 → JST の日付 "YYYY-MM-DD"（JST の 23:59 は当日、0:00 は翌日） */
export function toJstDateString(instant: Date): string {
  return new Date(instant.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → date 列にそのまま入る Date（UTC 0時） */
export function dateOnlyToDb(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** 年・月が正しいか（月は 1〜12） */
export function isValidYearMonth(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 1900 && year <= 9999 && month >= 1 && month <= 12;
}

/**
 * 年月の範囲 [gte, lt)。Prisma の where に { gte, lt } でそのまま渡せる。
 * lt（翌月1日の手前まで）にすることで「月末日」を計算しなくてよい。
 */
export function monthRange(year: number, month: number): { gte: Date; lt: Date } {
  if (!isValidYearMonth(year, month)) {
    throw new Error(`不正な年月です: ${year}-${month}`);
  }
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(year, month, 1)),
  };
}

/** その月の日数（UTC で計算するので TZ に左右されない） */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
