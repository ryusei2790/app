/**
 * @file lib/quota.ts
 * @description レシート読み取りの使いすぎ対策（テスト一覧 E: L1〜L6）。
 *
 * 上限: 1人 1日5枚・月30枚、アプリ全体 月3,000枚（環境変数で変えられる）。
 * 社長アカウント（OWNER_USER_IDS）は全体の上限から除き、全体の枚数にも数えない（本人決定 2026-10-08）。
 * 本人の1日・月の上限は社長にも効く。
 *
 * 使い方（レシート API）:
 *   const q = await reserveReceiptParse(user);      // 上限内なら予約（ここで1枚分を押さえる）
 *   if (!q.ok) return 429 + q.message;               // 日本語の理由
 *   try { AI で読む; await finishReceiptParse(q.logId, user.id, "succeeded", 使用量) }
 *   catch { await finishReceiptParse(q.logId, user.id, "failed") }  // 失敗は数えない（L6）
 * 予約と数える処理は DB 関数の中で1本に並べて行うので、同時に何回呼ばれても上限を超えない（L5）。
 */

import { isOwner } from "@/lib/features";
import { countReceiptUsage, finishReceiptParseRow, reserveReceiptParseRow } from "@/lib/admin-db";

export type QuotaReason = "user_day" | "user_month" | "global_month";

export interface QuotaLimits {
  userDay: number;
  userMonth: number;
  globalMonth: number;
}

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

/** 上限（呼ぶたびに環境変数を読む。テストや運用で変えたとき再起動なしで効くように） */
export function quotaLimits(): QuotaLimits {
  return {
    userDay: intEnv("RECEIPT_QUOTA_USER_DAY", 5),
    userMonth: intEnv("RECEIPT_QUOTA_USER_MONTH", 30),
    globalMonth: intEnv("RECEIPT_QUOTA_GLOBAL_MONTH", 3000),
  };
}

/** 画面にそのまま出す理由。どれも「手入力ならできる」ことを添える */
export function quotaMessage(reason: QuotaReason, limits: QuotaLimits = quotaLimits()): string {
  switch (reason) {
    case "user_day":
      return `今日のレシート読み取りは上限（${limits.userDay}枚）に達しました。日本時間の0時に戻ります。手入力なら今すぐ登録できます。`;
    case "user_month":
      return `今月のレシート読み取りは上限（${limits.userMonth}枚）に達しました。来月1日に戻ります。手入力なら今すぐ登録できます。`;
    case "global_month":
      return "今月はアプリ全体のレシート読み取りの上限に達したため、読み取りを止めています。来月1日に再開します。手入力なら今すぐ登録できます。";
  }
}

type User = { id: string; email?: string };

export type ReserveResult =
  | { ok: true; logId: string }
  | { ok: false; reason: QuotaReason; message: string };

/**
 * 1枚分を予約する。
 * @param opts.now テストで日・月の切り替えを確かめるためだけに使う（本番は省略＝いま）
 */
export async function reserveReceiptParse(user: User, opts: { now?: Date } = {}): Promise<ReserveResult> {
  const limits = quotaLimits();
  const r = await reserveReceiptParseRow({
    userId: user.id,
    userMonth: limits.userMonth,
    userDay: limits.userDay,
    globalMonth: limits.globalMonth,
    exemptGlobal: isOwner(user),
    now: opts.now ?? new Date(),
  });
  if (r.logId) return { ok: true, logId: r.logId };
  const reason = r.reason as QuotaReason;
  return { ok: false, reason, message: quotaMessage(reason, limits) };
}

/** 予約を閉じる。succeeded だけが枚数に数える（failed・cancelled は数えない: L6） */
export async function finishReceiptParse(
  logId: string,
  userId: string,
  status: "succeeded" | "failed" | "cancelled",
  usage?: { model?: string; inputTokens?: number; outputTokens?: number; costUsd?: number }
): Promise<void> {
  await finishReceiptParseRow(logId, userId, status, usage);
}

export interface ReceiptUsage {
  day: { used: number; limit: number; remaining: number };
  month: { used: number; limit: number; remaining: number };
  /** いま読み取りを使えるか（本人の残りがあり、全体も止まっていない） */
  available: boolean;
}

/** 残り回数（画面の表示用） */
export async function getReceiptUsage(user: User, opts: { now?: Date } = {}): Promise<ReceiptUsage> {
  const limits = quotaLimits();
  const c = await countReceiptUsage(user.id, opts.now ?? new Date());
  const day = { used: c.usedDay, limit: limits.userDay, remaining: Math.max(0, limits.userDay - c.usedDay) };
  const month = { used: c.usedMonth, limit: limits.userMonth, remaining: Math.max(0, limits.userMonth - c.usedMonth) };
  const globalOpen = isOwner(user) || c.usedGlobal < limits.globalMonth;
  return { day, month, available: day.remaining > 0 && month.remaining > 0 && globalOpen };
}
