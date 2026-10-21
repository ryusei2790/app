/**
 * @file api/v1/menu/route.ts
 * @description メニュー（固定＋マイメニュー）を返す・マイメニューを丸ごと置き換える（チャットの「元に戻す」用）。mywork#573
 */

import { error, ok, readJsonBody, requireAuth } from "@/lib/api-helpers";
import { isOwner } from "@/lib/features";
import { buildMenu, validateLayout, visibleLayout } from "@/lib/menu/layout";
import { loadLayout, saveLayout } from "@/lib/menu/store";

/** GET /api/v1/menu */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- route handler の形をそろえるため受け取る
export async function GET(_request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const owner = isOwner(user);
  const layout = visibleLayout(await loadLayout(user.id), { isOwner: owner });
  return ok({ layout, menu: buildMenu(layout, { isOwner: owner }) });
}

/** PUT /api/v1/menu  body: { layout: [{ featureId, icon, label }] } */
export async function PUT(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const { body, response: bad } = await readJsonBody(request);
  if (bad) return bad;
  const owner = isOwner(user);
  const layout = validateLayout(body.layout, { isOwner: owner });
  if (!layout) return error("VALIDATION_ERROR", "マイメニューの形が不正です", 422);
  await saveLayout(user.id, layout);
  return ok({ layout, menu: buildMenu(layout, { isOwner: owner }) });
}
