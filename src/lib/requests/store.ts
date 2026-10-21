/**
 * @file lib/requests/store.ts
 * @description 無い機能の要望（mywork#573 第2弾）。本人の分の作成・一覧は withUserDb の中（RLS が効く）で行う。
 * 社長の全件一覧と状態の変更は lib/admin-db.ts（listAllFeatureRequests・setFeatureRequestStatus）。
 */

import { withUserDb } from "@/lib/db";
import { type FeatureRequestRow, type RequestStatus } from "./status";

export { cleanRequestText, isRequestStatus } from "./status";

export async function createFeatureRequest(userId: string, text: string): Promise<FeatureRequestRow> {
  return withUserDb(userId, async (db) => {
    const r = await db.featureRequest.create({ data: { userId, text } });
    return { id: r.id, text: r.text, status: r.status as RequestStatus, createdAt: r.createdAt.toISOString() };
  });
}

export async function listMyFeatureRequests(userId: string): Promise<FeatureRequestRow[]> {
  return withUserDb(userId, async (db) => {
    const rows = await db.featureRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map((r) => ({ id: r.id, text: r.text, status: r.status as RequestStatus, createdAt: r.createdAt.toISOString() }));
  });
}
