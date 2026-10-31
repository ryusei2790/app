/**
 * @file lib/billing/stripe.ts
 * @description Stripe の接続口（mywork#970）。鍵はサーバーの環境変数だけで持つ。
 * 鍵か価格 ID が無い環境では課金を「未設定」として扱い、画面に決済ボタンを出さない。
 */

import Stripe from "stripe";

export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY が未設定です");
  return new Stripe(key);
}
