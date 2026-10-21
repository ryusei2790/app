/**
 * @file api/v1/requests/route.ts
 * @description 自分が送った機能の要望の一覧（mywork#573 第2弾）。要望を作るのはチャット（/api/v1/chat）だけ。
 */

import { ok, requireAuth } from "@/lib/api-helpers";
import { listMyFeatureRequests } from "@/lib/requests/store";

/** GET /api/v1/requests */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- route handler の形をそろえるため受け取る
export async function GET(_request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  return ok({ requests: await listMyFeatureRequests(user.id) });
}
