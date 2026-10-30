/**
 * @file api/stripe/checkout/route.ts
 * @description 有料プランの決済ページの URL を返す（mywork#970）。カード情報は Stripe の画面だけが扱う。
 * 本人アカウントと、すでに有料の人は 409（二重課金を防ぐ）。解約後の再加入は同じ Stripe の顧客を使う。
 */

import { error, ok, requireAuth } from "@/lib/api-helpers";
import { getSubscriptionRow } from "@/lib/admin-db";
import { isPaidStatus } from "@/lib/billing/plan";
import { billingConfigured, getStripe } from "@/lib/billing/stripe";
import { isOwner } from "@/lib/features";

/** POST /api/stripe/checkout */
export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  if (!billingConfigured()) return error("BILLING_UNAVAILABLE", "いま有料プランの申し込みはできません", 503);
  if (isOwner(user)) return error("CONFLICT", "このアカウントは回数の上限がありません", 409);

  const row = await getSubscriptionRow(user.id);
  if (isPaidStatus(row?.status)) return error("CONFLICT", "すでに有料プランです", 409);

  const origin = new URL(request.url).origin;
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    locale: "ja",
    client_reference_id: user.id,
    // 以後の Webhook は契約の metadata で本人を特定する
    subscription_data: { metadata: { user_id: user.id } },
    ...(row ? { customer: row.stripeCustomerId } : { customer_email: user.email }),
    success_url: `${origin}/settings#plan`,
    cancel_url: `${origin}/settings#plan`,
  });
  if (!session.url) return error("INTERNAL_ERROR", "決済ページを開けませんでした", 500);
  return ok({ url: session.url });
}
