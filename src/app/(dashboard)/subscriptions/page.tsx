/**
 * @file app/(dashboard)/subscriptions/page.tsx
 * @description サブスク一覧（mywork#742 ②）。定期のうちサブスクの印が付いたものを、次回更新が近い順に出す（Server Component）。
 */

import { SubscriptionView } from "@/components/subscriptions/SubscriptionView";

export default function SubscriptionsPage() {
  return <SubscriptionView />;
}
