/**
 * @file lib/menu/menu-for-user.ts
 * @description サーバー側で本人のメニュー（固定＋マイメニュー）を作る（layout.tsx・API から使う）。
 */

import { isOwner } from "@/lib/features";
import { buildMenu } from "./layout";
import { loadLayout } from "./store";

export async function menuForUser(user: { id: string; email?: string }) {
  const owner = isOwner(user);
  return buildMenu(await loadLayout(user.id), { isOwner: owner });
}
