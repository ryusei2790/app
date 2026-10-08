/**
 * @file lib/admin-db.ts
 * @description RLS を通らない管理者接続（prisma）を使う処理だけを集めた窓口。
 *
 * なぜ分けるか:
 *   ふだんの DB 操作は lib/db.ts の withUserDb（RLS が効く）だけで行う。ただし
 *   「全員の中から定期の展開が必要な人を探す」「アプリ全体のレシート読み取り回数を数える」のように
 *   1人の権限では見えないものが要る処理がある。それをここに閉じ込め、
 *   - 引数は検証済みの値だけ（ユーザー ID は JWT 由来、日付は JST の今日）
 *   - 返すのは必要最小限（ID や件数）で、他人の取引の中身は返さない
 *   とする。eslint で、このファイル以外から prisma を直接 import することを禁止している。
 */

import { prisma } from "./prisma";
import { dateOnlyToDb } from "./date/jst";

/** 今日まで展開が済んでいない有効な定期を持つ人の ID（定期実行 R5 用） */
export async function listUserIdsWithPendingFixedCosts(today: string): Promise<string[]> {
  const rows = await prisma.fixedCost.findMany({
    where: {
      isActive: true,
      startDate: { lte: dateOnlyToDb(today) },
      OR: [{ generatedThrough: null }, { generatedThrough: { lt: dateOnlyToDb(today) } }],
    },
    distinct: ["userId"],
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

// ─── レシート読み取りの回数（テスト一覧 E）。上限の判断そのものは lib/quota.ts ─────────────

export interface ReceiptUsageCounts {
  usedDay: number;
  usedMonth: number;
  usedGlobal: number;
}

/**
 * 上限内なら予約を1行入れて id を返す（DB 関数 reserve_receipt_parse。ロック→数える→入れる を1文で行う）。
 * 超えていれば logId=null と理由。userId は JWT 由来の検証済みの値だけを渡すこと。
 */
export async function reserveReceiptParseRow(args: {
  userId: string;
  userMonth: number;
  userDay: number;
  globalMonth: number;
  exemptGlobal: boolean;
  now: Date;
}): Promise<ReceiptUsageCounts & { logId: string | null; reason: string | null }> {
  const rows = await prisma.$queryRaw<
    { log_id: string | null; reason: string | null; used_day: number; used_month: number; used_global: number }[]
  >`SELECT * FROM public.reserve_receipt_parse(
      ${args.userId}::uuid, ${args.userMonth}::int, ${args.userDay}::int,
      ${args.globalMonth}::int, ${args.exemptGlobal}::boolean, ${args.now}::timestamptz)`;
  const r = rows[0];
  return { logId: r.log_id, reason: r.reason, usedDay: r.used_day, usedMonth: r.used_month, usedGlobal: r.used_global };
}

/** 予約を閉じる。本人の・まだ予約中の行だけを変える（他人の id を渡されても何もしない） */
export async function finishReceiptParseRow(
  logId: string,
  userId: string,
  status: "succeeded" | "failed" | "cancelled",
  usage: { model?: string; inputTokens?: number; outputTokens?: number; costUsd?: number } = {}
): Promise<void> {
  await prisma.receiptParseLog.updateMany({
    where: { id: logId, userId, status: "reserved" },
    data: {
      status,
      finishedAt: new Date(),
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
    },
  });
}

/** 使った枚数（本人の今日・今月、全体の今月） */
export async function countReceiptUsage(userId: string, now: Date): Promise<ReceiptUsageCounts> {
  const rows = await prisma.$queryRaw<{ used_day: number; used_month: number; used_global: number }[]>`
    SELECT * FROM public.receipt_usage(${userId}::uuid, ${now}::timestamptz)`;
  const r = rows[0];
  return { usedDay: r.used_day, usedMonth: r.used_month, usedGlobal: r.used_global };
}
