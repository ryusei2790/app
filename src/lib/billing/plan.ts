/**
 * @file lib/billing/plan.ts
 * @description 有料プランかどうかの判定（mywork#970）。上限の値そのものは lib/quota.ts。
 */

import { getSubscriptionRow } from "@/lib/admin-db";

/** past_due（カード失敗で再試行中）などは有料に数えない */
export function isPaidStatus(status: string | undefined): boolean {
  return status === "active" || status === "trialing";
}

export async function isPaidUser(userId: string): Promise<boolean> {
  return isPaidStatus((await getSubscriptionRow(userId))?.status);
}
