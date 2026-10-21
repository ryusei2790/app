/**
 * @file app/(dashboard)/requests/page.tsx
 * @description 機能の要望（mywork#573 第2弾）。自分が送った要望と状態を見る。社長には全員の要望と状態の変更も出す。
 */

import { getAuthUser } from "@/lib/api-helpers";
import { isOwner } from "@/lib/features";
import { RequestsView } from "@/components/requests/RequestsView";

export default async function RequestsPage() {
  const user = await getAuthUser();
  return <RequestsView isOwner={isOwner(user)} />;
}
