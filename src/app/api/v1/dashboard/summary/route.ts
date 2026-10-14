/**
 * @file api/v1/dashboard/summary/route.ts
 * @description GET /api/v1/dashboard/summary?year=YYYY&month=M — 互換のために残す古い入口。
 * 中身は /api/v1/summary と同じ（api/v1/summary/handler.ts）。数字の定義は lib/aggregate（mywork#425 第1弾）。
 * 以前はここで DB の RPC monthly_summary を呼んで月の全部を足していたが、「支出」の計算が画面ごとに違う原因だったので
 * 1か所（summarize）に寄せた。古い型（total_income・total_expense・balance・by_category・fixed・upcoming）も同じ数字で返す。
 */

import type { NextRequest } from "next/server";
import { summaryGet } from "../../summary/handler";

export async function GET(request: NextRequest) {
  return summaryGet(request);
}
