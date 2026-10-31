/**
 * @file lib/billing/plan.ts
 * @description 有料プランかどうかの判定（mywork#970）。上限の値そのものは lib/quota.ts。
 */

import { getSubscriptionRow } from "@/lib/admin-db";

/** past_due（カード失敗で再試行中）などは有料に数えない */
export function isPaidStatus(status: string | undefined): boolean {
  return status === "active" || status === "trialing";
}

/**
 * 契約がまだ生きている。past_due は使えないが請求の再試行中なので、新しく申し込ませると二重課金になる。
 * 申し込みボタンを止める判定に使い、カードの更新は Customer Portal へ案内する。
 */
export function hasOpenSubscription(status: string | undefined): boolean {
  return status !== undefined && !["canceled", "incomplete_expired"].includes(status);
}

export async function isPaidUser(userId: string): Promise<boolean> {
  return isPaidStatus((await getSubscriptionRow(userId))?.status);
}
