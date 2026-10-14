/**
 * @file api/v1/review/route.ts
 * @description GET /api/v1/review?month=YYYY-MM — 「要確認」の一覧（mywork#425 第1弾、テスト一覧 D11）。
 * 返金候補・未割り当て・予定・重複候補を、取引の id 付きで返す（画面でその場に直せるように）。
 * 列挙は lib/aggregate/review.ts（純粋関数）。DB は withUserDb（RLS）で自分の行だけ。
 */

import type { NextRequest } from "next/server";
import { withUserDb } from "@/lib/db";
import { error, ok, requireAuth } from "@/lib/api-helpers";
import { todayJst } from "@/lib/date/jst";
import { loadMonthTxs } from "@/lib/aggregate/load";
import { review, type ReviewItem } from "@/lib/aggregate/review";
import { parseMonthParam } from "../summary/handler";

function serializeItem(i: ReviewItem) {
  return {
    id: i.id,
    date: i.date,
    amount: i.amount,
    type: i.type,
    kind: i.kind,
    category_id: i.categoryId,
    category_name: i.categoryName,
    note: i.note,
    source: i.source,
    reason: i.reason,
  };
}

export async function GET(request: NextRequest) {
  const { user, response } = await requireAuth();
  if (response) return response;

  const today = todayJst();
  const month = parseMonthParam(request.nextUrl.searchParams, today);
  if (month === null) return error("VALIDATION_ERROR", "month は YYYY-MM で指定してください", 422);

  const txs = await withUserDb(user.id, (db) => loadMonthTxs(db, user.id, month));
  const r = review(txs, { month, today });
  return ok({
    month,
    today,
    refund_candidates: r.refundCandidates.map(serializeItem),
    unassigned: r.unassigned.map(serializeItem),
    scheduled: r.scheduled.map(serializeItem),
    duplicates: r.duplicates.map((g) => ({ key: g.key, items: g.items.map(serializeItem) })),
  });
}
