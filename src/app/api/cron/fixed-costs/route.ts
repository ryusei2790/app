/**
 * @file api/cron/fixed-costs/route.ts
 * @description 毎日の定期実行の入口（テスト一覧 R5）。Vercel Cron が1日1回 GET で呼ぶ（vercel.json）。
 *
 * 守り: Authorization: Bearer <CRON_SECRET> が一致したときだけ動く。
 *   - CRON_SECRET が未設定なら誰が呼んでも 401（設定漏れで誰でも叩ける状態にしない）
 *   - 比較は timingSafeEqual（文字を1つずつ当てていく攻撃で鍵を推測されないように）
 * Vercel Cron は環境変数 CRON_SECRET を設定すると自動でこのヘッダを付けて呼ぶ。
 * ログインは要らない（proxy.ts の保護対象は画面だけで、/api は各 route が自分で確かめる）。
 */

import { timingSafeEqual } from "node:crypto";
import { runFixedCostExpansion } from "@/lib/fixed-costs/cron";
import { ok, error } from "@/lib/api-helpers";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** GET /api/cron/fixed-costs — 全員の定期を今日（JST）まで展開する */
export async function GET(request: Request) {
  if (!authorized(request)) return error("UNAUTHORIZED", "認証が必要です", 401);
  const result = await runFixedCostExpansion();
  return ok(result);
}
