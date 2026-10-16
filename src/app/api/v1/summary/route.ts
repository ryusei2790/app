/**
 * @file api/v1/summary/route.ts
 * @description GET /api/v1/summary?month=YYYY-MM — 月の集計（統一 API）。中身は handler.ts。
 */

import type { NextRequest } from "next/server";
import { summaryGet } from "./handler";

export async function GET(request: NextRequest) {
  return summaryGet(request);
}
