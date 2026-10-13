/**
 * @file api/v1/usage/route.ts
 * @description レシート読み取りの残り回数（今日・今月）と、いま使えるかを返す（テスト一覧 E）。
 * 画面で「今日あと◯枚」を出し、使えないときは最初から手入力に案内するために使う。
 * 全体の枚数（他人の利用状況）は返さず、使えるかどうか（available）だけを返す。
 */

import { getReceiptUsage } from "@/lib/quota";
import { ok, requireAuth } from "@/lib/api-helpers";

/** GET /api/v1/usage */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- route handler の形をそろえるため受け取る
export async function GET(_request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  return ok(await getReceiptUsage(user));
}
