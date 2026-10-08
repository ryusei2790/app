/**
 * @file api/v1/fixed-costs/generate/route.ts
 * @description 画面を開いたときに、ログイン中の本人の定期支出・定期収入を今日（JST）まで展開する。
 * 毎日の定期実行（api/cron/fixed-costs）と同じ処理（lib/fixed-costs/expand.ts）を本人の分だけ呼ぶ。
 * 冪等（何度呼んでも二重に作らない）。旧版の body（year, month）は受け取っても使わない。
 * DB には withUserDb（RLS が効く）経由でだけ触る。
 */

import { withUserDb } from "@/lib/db";
import { todayJst } from "@/lib/date/jst";
import { expandFixedCostsForUser } from "@/lib/fixed-costs/expand";
import { ok, requireAuth } from "@/lib/api-helpers";

/** POST /api/v1/fixed-costs/generate — 本人の定期を今日まで展開 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 旧版の呼び出し（body 付き）と型を合わせるため受け取る
export async function POST(_request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const generated = await withUserDb(user.id, (db) => expandFixedCostsForUser(db, user.id, todayJst()));
  return ok({ generated_count: generated });
}
