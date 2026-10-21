/**
 * @file api/v1/admin/requests/route.ts
 * @description 社長の要望一覧（mywork#573 第2弾）。全員の要望を見て、状態（受付・対応中・完了・見送り）を変える。
 * 社長以外は 403（requireOwner）。
 */

import { error, ok, readJsonBody, requireOwner } from "@/lib/api-helpers";
import { listAllFeatureRequests, setFeatureRequestStatus } from "@/lib/admin-db";
import { isUuid } from "@/lib/db";
import { isRequestStatus } from "@/lib/requests/store";

/** GET /api/v1/admin/requests */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- route handler の形をそろえるため受け取る
export async function GET(_request: Request) {
  const { response } = await requireOwner();
  if (response) return response;
  return ok({ requests: await listAllFeatureRequests() });
}

/** PATCH /api/v1/admin/requests  body: { id, status } */
export async function PATCH(request: Request) {
  const { response } = await requireOwner();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  if (!isUuid(body.id) || !isRequestStatus(body.status)) return error("VALIDATION_ERROR", "id か状態が不正です", 422);
  if (!(await setFeatureRequestStatus(body.id, body.status))) return error("NOT_FOUND", "要望が見つかりません", 404);
  return ok({ id: body.id, status: body.status });
}
