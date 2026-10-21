/**
 * @file lib/menu/store.ts
 * @description マイメニューとチャット回数の読み書き（mywork#573）。どれも withUserDb の中（RLS が効く）で行う。
 */

import { withUserDb } from "@/lib/db";
import { todayJst } from "@/lib/date/jst";
import type { LayoutItem } from "./layout";

export async function loadLayout(userId: string): Promise<LayoutItem[]> {
  return withUserDb(userId, async (db) => {
    const rows = await db.userLayout.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { featureId: "asc" }] });
    return rows.map((r) => ({ featureId: r.featureId, icon: r.icon, label: r.label }));
  });
}

/** マイメニューを丸ごと置き換える（並び順は配列の順） */
export async function saveLayout(userId: string, layout: LayoutItem[]): Promise<void> {
  await withUserDb(userId, async (db) => {
    await db.userLayout.deleteMany({ where: { userId } });
    if (layout.length > 0) {
      await db.userLayout.createMany({
        data: layout.map((item, position) => ({ userId, featureId: item.featureId, position, icon: item.icon, label: item.label })),
      });
    }
  });
}

/** 今日のチャット回数を1つ増やし、増やした後の回数を返す（同時に呼ばれても1行で数える） */
export async function bumpChatUsage(userId: string): Promise<number> {
  const day = todayJst();
  return withUserDb(userId, async (db) => {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO chat_usage (user_id, day, count) VALUES (${userId}::uuid, ${day}::date, 1)
      ON CONFLICT (user_id, day) DO UPDATE SET count = chat_usage.count + 1
      RETURNING count`;
    return Number(rows[0]?.count ?? 0);
  });
}
