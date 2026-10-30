/**
 * @file api/v1/widget/summary/route.ts
 * @description GET /api/v1/widget/summary — ウィジェット用の今月の集計。中身は handler.ts。
 */

import { widgetSummaryGet } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return widgetSummaryGet(request);
}
