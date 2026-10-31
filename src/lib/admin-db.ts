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
import type { Utm } from "./lp/utm";

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

// ─── 無い機能の要望（mywork#573 第2弾）。社長の一覧画面だけが使う（route 側で requireOwner） ─────────────

/** 全員の要望（新しい順）。返すのは要望文・状態・日時と、誰のものかを見分ける短い印だけ */
export async function listAllFeatureRequests() {
  const rows = await prisma.featureRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    userTag: r.userId.slice(0, 8),
  }));
}

/** 要望の状態を変える。見つからなければ false */
export async function setFeatureRequestStatus(id: string, status: string): Promise<boolean> {
  const r = await prisma.featureRequest.updateMany({ where: { id }, data: { status, updatedAt: new Date() } });
  return r.count > 0;
}

// ─── 広告の着地ページ（mywork#878）。表は RLS 有効・ポリシー無しで、ここからしか読み書きしない ───


const utmCols = (u: Utm) => ({
  utmSource: u.utm_source ?? null,
  utmMedium: u.utm_medium ?? null,
  utmCampaign: u.utm_campaign ?? null,
  utmContent: u.utm_content ?? null,
});

/** 着地ページを開いた記録。同じ visitor の 30 分以内の重複は数えない。数えたら true */
export async function recordLpView(args: {
  visitorId: string;
  utm: Utm;
  referrerHost?: string;
  now: Date;
}): Promise<boolean> {
  const since = new Date(args.now.getTime() - 30 * 60 * 1000);
  const recent = await prisma.lpView.count({ where: { visitorId: args.visitorId, viewedAt: { gte: since } } });
  if (recent > 0) return false;
  await prisma.lpView.create({
    data: { visitorId: args.visitorId, viewedAt: args.now, referrerHost: args.referrerHost ?? null, ...utmCols(args.utm) },
  });
  return true;
}

/** 直近1分の事前登録の試行数（連打対策。visitor ごと） */
export async function countRecentWaitlistByVisitor(visitorId: string, now: Date): Promise<number> {
  return prisma.waitlistSignup.count({
    where: { visitorId, createdAt: { gte: new Date(now.getTime() - 60 * 1000) } },
  });
}

/** 事前登録。同じアドレスは2件目を作らない（既にあれば false）。email は normalizeEmail 済みのものだけ */
export async function insertWaitlistSignup(args: { email: string; visitorId: string | null; utm: Utm }): Promise<boolean> {
  const r = await prisma.waitlistSignup.createMany({
    data: [{ email: args.email, visitorId: args.visitorId, ...utmCols(args.utm) }],
    skipDuplicates: true,
  });
  return r.count > 0;
}

export interface WaitlistRow {
  createdAt: Date;
  email: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
}

/** 社長だけが見る事前登録の一覧と、utm_content 別の「開いた数（人）・登録数」 */
export async function getWaitlistReport(): Promise<{
  signups: WaitlistRow[];
  byContent: { utmContent: string | null; views: number; visitors: number; signups: number }[];
}> {
  const signups = await prisma.waitlistSignup.findMany({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, email: true, utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true },
  });
  const views = await prisma.$queryRaw<{ utm_content: string | null; views: bigint; visitors: bigint }[]>`
    SELECT utm_content, count(*) AS views, count(DISTINCT visitor_id) AS visitors FROM lp_views GROUP BY utm_content`;
  const map = new Map<string | null, { views: number; visitors: number; signups: number }>();
  for (const v of views) map.set(v.utm_content, { views: Number(v.views), visitors: Number(v.visitors), signups: 0 });
  for (const s of signups) {
    const cur = map.get(s.utmContent) ?? { views: 0, visitors: 0, signups: 0 };
    cur.signups += 1;
    map.set(s.utmContent, cur);
  }
  const byContent = [...map.entries()]
    .map(([utmContent, c]) => ({ utmContent, ...c }))
    .sort((a, b) => (a.utmContent ?? "~").localeCompare(b.utmContent ?? "~"));
  return { signups, byContent };
}

// ─── 有料プラン（mywork#970）。書くのは署名検証済みの Webhook だけ ─────────────

export interface SubscriptionRow {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodEnd: Date | null;
}

export async function getSubscriptionRow(userId: string): Promise<SubscriptionRow | null> {
  return prisma.subscription.findUnique({
    where: { userId },
    select: {
      userId: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      status: true,
      currentPeriodEnd: true,
    },
  });
}

export async function upsertSubscriptionRow(row: SubscriptionRow): Promise<void> {
  const { userId, ...fields } = row;
  await prisma.subscription.upsert({ where: { userId }, create: row, update: fields });
}
