/**
 * @file lib/fixed-costs/expand.ts
 * @description 定期支出・定期収入を取引（transactions, source='auto'）に展開する（テスト一覧 R4〜R8）。
 *
 * 1人分の有効な定期について、「展開済みの印（generated_through）の翌日〜今日」の支払日の取引を作り、
 * 最後に印を今日に進める。印より前は二度と見ないので:
 *   - 何度走っても同じ日の取引を2回作らない（R5 冪等）
 *   - 数か月走らなくても、次の1回で抜けた回がすべて作られる（R6 補完）
 *   - 定期を編集しても、作成済みの取引（＝印より前）は書き換えない（R8）
 * 同時に2回走った場合の重複は、DB の一意索引（fixed_cost_id, transaction_date）＋ skipDuplicates で止める。
 *
 * 呼ぶ側:
 *   - 画面を開いたとき: api/v1/fixed-costs/generate（ログイン中の本人の分）
 *   - 毎日の定期実行: lib/fixed-costs/cron.ts（全員の分。アプリを開かない人にも作る）
 * どちらも withUserDb の中で呼ぶので RLS が効く。
 */

import type { UserDb } from "@/lib/db";
import { dateOnlyToDb, dbToDateOnly } from "@/lib/date/jst";
import { addDays, nextOccurrence, occurrencesBetween, type Cycle, type ScheduleRule } from "./schedule";

/**
 * @param today JST の今日 "YYYY-MM-DD"（ここまでを作る）。テストで日付を動かせるよう引数で受ける
 * @returns 新しく作った取引の件数
 */
export async function expandFixedCostsForUser(db: UserDb, userId: string, today: string): Promise<number> {
  // 1. 有効で、開始日が今日以前の定期だけ（一時停止中・未開始は作らない: R7）
  const fixedCosts = await db.fixedCost.findMany({
    where: { userId, isActive: true, startDate: { lte: dateOnlyToDb(today) } },
  });

  let created = 0;
  const advanced: string[] = [];
  for (const fc of fixedCosts) {
    const done = fc.generatedThrough ? dbToDateOnly(fc.generatedThrough) : null;
    if (done !== null && done >= today) continue; // 今日まで展開済み

    // 2. 印の翌日（初回は開始日）から今日までの支払日を計算
    const dates = occurrencesBetween(
      ruleFromRecord(fc),
      done === null ? dbToDateOnly(fc.startDate) : addDays(done, 1),
      today
    );

    // 3. 取引を作る。金額・名前・種別は「いまの定期の値」を写す（作った後の取引は定期と独立）
    if (dates.length > 0) {
      const res = await db.transaction.createMany({
        data: dates.map((d) => ({
          userId,
          accountId: fc.accountId,
          categoryId: fc.categoryId,
          fixedCostId: fc.id,
          amount: fc.amount,
          type: fc.type,
          transactionDate: dateOnlyToDb(d),
          note: fc.name,
          source: "auto",
        })),
        skipDuplicates: true,
      });
      created += res.count;
    }
    advanced.push(fc.id);
  }

  // 4. 印を今日に進める（まとめて1回）
  if (advanced.length > 0) {
    await db.fixedCost.updateMany({
      where: { userId, id: { in: advanced } },
      data: { generatedThrough: dateOnlyToDb(today) },
    });
  }
  return created;
}

/** DB の定期の行 → 支払日計算の規則（一覧の次回日付でも使う） */
export function ruleFromRecord(fc: {
  cycle: string;
  billingDay: number | null;
  billingMonth: number | null;
  startDate: Date;
  endDate: Date | null;
}): ScheduleRule {
  return {
    cycle: fc.cycle as Cycle,
    billingDay: fc.billingDay,
    billingMonth: fc.billingMonth,
    startDate: dbToDateOnly(fc.startDate),
    endDate: fc.endDate ? dbToDateOnly(fc.endDate) : null,
  };
}

/**
 * 次回の支払日（まだ取引になっていない最初の回）。一時停止中は null（R9）。
 * 「今日」と「展開済みの印の翌日」の遅い方から探す。
 */
export function nextDueDate(
  fc: Parameters<typeof ruleFromRecord>[0] & { isActive: boolean; generatedThrough: Date | null },
  today: string
): string | null {
  if (!fc.isActive) return null;
  const afterDone = fc.generatedThrough ? addDays(dbToDateOnly(fc.generatedThrough), 1) : today;
  return nextOccurrence(ruleFromRecord(fc), afterDone > today ? afterDone : today);
}
