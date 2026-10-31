/**
 * @file api/stripe/webhook/route.ts
 * @description Stripe の Webhook（mywork#970）。subscriptions 表に書く唯一の入口。
 * 署名は生の本文で検証するので、JSON に直す前の text を使う。署名が違えば 400 で何もしない。
 */

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook";

/** POST /api/stripe/webhook */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  try {
    await handleStripeEvent(event, (id) => stripe.subscriptions.retrieve(id));
  } catch (e) {
    console.error("[stripe] Webhook の処理に失敗", event.type, e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
