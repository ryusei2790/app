/**
 * @file api/health/route.ts
 * @description 見張り用の入口（mywork#764 ④）。Mac の launchd（scripts/monitor/check.sh）が毎日呼ぶ。
 *
 * 返すのは「DB に届くか」「毎日の定期実行が今日の分まで済んでいるか」の真偽だけ（件数・ID・中身は返さない）ので、
 * ログイン無しで読めてよい。呼ばれるたびに DB を1回読むので、Supabase 無料枠の「7日アクセスなしで休止」の予防も兼ねる。
 * どちらかが駄目なら 503（check.sh はステータスで判断して Issue を立てる）。
 */

import { listUserIdsWithPendingFixedCosts } from "@/lib/admin-db";
import { todayJst } from "@/lib/date/jst";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/health — { db, cron } を返す。cron=false は「今日の分がまだ作られていない人がいる」 */
export async function GET() {
  let db = true;
  let cron = true;
  try {
    // 定期実行は毎日 0:05 JST。それ以降に未展開の人が残っていれば止まっている
    cron = (await listUserIdsWithPendingFixedCosts(todayJst())).length === 0;
  } catch (e) {
    db = false;
    cron = false;
    console.error("[health] DB に届かない", e instanceof Error ? e.name : "unknown");
  }
  return NextResponse.json({ db, cron }, { status: db && cron ? 200 : 503 });
}
