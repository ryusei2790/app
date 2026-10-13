/**
 * @file lib/fixed-costs/cron.ts
 * @description 毎日の定期実行で、全員の定期支出・定期収入を今日まで展開する（テスト一覧 R5）。
 * アプリを開かない人の分も作るためのもの。入口は api/cron/fixed-costs（CRON_SECRET で守る）。
 *
 * 「展開が必要な人」の一覧だけは RLS を通らない管理者接続（lib/admin-db.ts）で読む（全員分を見る必要があるため）。
 * 読むのはユーザー ID だけで、実際の展開は1人ずつ withUserDb（RLS が効く）の中で行う。
 * 1人の失敗で全員が止まらないよう、人ごとに例外を受け止めて数える。
 */

import { listUserIdsWithPendingFixedCosts } from "@/lib/admin-db";
import { withUserDb } from "@/lib/db";
import { todayJst } from "@/lib/date/jst";
import { expandFixedCostsForUser } from "./expand";

export interface CronResult {
  users: number;
  generated: number;
  failed: number;
}

export async function runFixedCostExpansion(today: string = todayJst()): Promise<CronResult> {
  // 1. 今日まで展開が済んでいない有効な定期を持つ人（印が今日以降の人は飛ばす）
  const userIds = await listUserIdsWithPendingFixedCosts(today);

  // 2. 1人ずつ、その人の権限（RLS）で展開する
  const result: CronResult = { users: userIds.length, generated: 0, failed: 0 };
  for (const userId of userIds) {
    try {
      result.generated += await withUserDb(userId, (db) => expandFixedCostsForUser(db, userId, today));
    } catch (e) {
      result.failed += 1;
      // ユーザー ID と例外の種類だけ残す（金額・名前などの中身はログに出さない）
      console.error("[cron/fixed-costs] 展開に失敗", userId, e instanceof Error ? e.name : "unknown");
    }
  }
  return result;
}
