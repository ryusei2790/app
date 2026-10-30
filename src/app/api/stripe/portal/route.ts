/**
 * @file api/stripe/portal/route.ts
 * @description 解約・カード変更の Stripe の画面（Customer Portal）の URL を返す（mywork#970）。
 */

import { error, ok, requireAuth } from "@/lib/api-helpers";
import { getSubscriptionRow } from "@/lib/admin-db";
import { getStripe } from "@/lib/billing/stripe";

/** POST /api/stripe/portal */
export async function POST(request: Request) {
  const { user, response } = await requireAuth();
  if (response) return response;
  const row = await getSubscriptionRow(user.id);
  if (!row) return error("NOT_FOUND", "有料プランの契約がありません", 404);
  const session = await getStripe().billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${new URL(request.url).origin}/settings#plan`,
  });
  return ok({ url: session.url });
}
