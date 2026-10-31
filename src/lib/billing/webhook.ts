/**
 * @file lib/billing/webhook.ts
 * @description Stripe のイベントを subscriptions 表へ写す（mywork#970）。
 *
 * イベントの中身は使わず、毎回 Stripe から最新の契約を取り直す。Webhook は順不同・再送ありで届くので、
 * 届いた順に書くと古い状態で上書きしてしまうため。取得に失敗したら例外を投げ、500 で Stripe に再送させる。
 */

import type Stripe from "stripe";
import { getSubscriptionRow, upsertSubscriptionRow } from "@/lib/admin-db";
import { isPaidStatus } from "@/lib/billing/plan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FetchSubscription = (id: string) => Promise<Stripe.Subscription>;

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

function subscriptionIdOf(event: Stripe.Event): string | null {
  switch (event.type) {
    case "checkout.session.completed":
      return idOf(event.data.object.subscription);
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return event.data.object.id;
    default:
      return null;
  }
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  // user_id は決済を始めるときに本人のセッションから入れた値（api/stripe/checkout）
  const userId = sub.metadata.user_id;
  const customerId = idOf(sub.customer);
  if (!userId || !UUID.test(userId) || !customerId) {
    console.error("[stripe] user_id の無い契約を無視", sub.id);
    return;
  }
  // 解約済みの古い契約の遅れた通知で、いま有効な別の契約を消さない
  const current = await getSubscriptionRow(userId);
  if (current && current.stripeSubscriptionId !== sub.id && isPaidStatus(current.status) && !isPaidStatus(sub.status)) {
    return;
  }
  const periodEnd = sub.items.data[0]?.current_period_end;
  await upsertSubscriptionRow({
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
  });
}

export async function handleStripeEvent(event: Stripe.Event, fetchSubscription: FetchSubscription): Promise<void> {
  const id = subscriptionIdOf(event);
  if (!id) return;
  await syncSubscription(await fetchSubscription(id));
}
