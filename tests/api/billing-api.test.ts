/**
 * @file tests/api/billing-api.test.ts
 * @description 有料プラン（mywork#970）。Webhook の署名と表への反映、上限の切り替えをローカル Supabase で確かめる。
 * Stripe には接続しない。署名は SDK のテスト用ヘッダーで作り、契約の取得は差し替える。
 */

import Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/supabase-server-mock"));

import { signInAs } from "../helpers/auth-state";
import { adminSql, closeAdminSql, createTestUser, type TestUser } from "../helpers/local-supabase";
import { getSubscriptionRow } from "@/lib/admin-db";
import { prisma } from "@/lib/prisma";
import { getReceiptUsage, quotaLimits, reserveReceiptParse } from "@/lib/quota";
import { handleStripeEvent } from "@/lib/billing/webhook";
import * as webhook from "@/app/api/stripe/webhook/route";
import * as checkout from "@/app/api/stripe/checkout/route";

const SECRET = "whsec_test";
const stripe = new Stripe("sk_test_dummy");
const users: TestUser[] = [];

function sub(u: TestUser, id: string, status: string): Stripe.Subscription {
  return {
    id,
    status,
    customer: `cus_${u.id}`,
    metadata: { user_id: u.id },
    items: { data: [{ current_period_end: 1893456000 }] },
  } as unknown as Stripe.Subscription;
}
const event = (type: string, object: object) => ({ type, data: { object } }) as unknown as Stripe.Event;
const updated = (id: string) => event("customer.subscription.updated", { id });

async function newUser(label: string) {
  const u = await createTestUser(label);
  users.push(u);
  return u;
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_PRICE_ID = "price_test";
});

afterEach(() => {
  signInAs(null);
  delete process.env.OWNER_USER_IDS;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_PRICE_ID;
});

afterAll(async () => {
  await adminSql("DELETE FROM subscriptions WHERE user_id = ANY($1::uuid[])", [users.map((u) => u.id)]);
  await adminSql("DELETE FROM receipt_parse_logs WHERE user_id = ANY($1::uuid[])", [users.map((u) => u.id)]);
  await prisma.$disconnect();
  await closeAdminSql();
});

describe("Webhook の署名", () => {
  it("署名が違えば 400", async () => {
    const res = await webhook.POST(
      new Request("http://x/api/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "bad" } })
    );
    expect(res.status).toBe(400);
  });

  it("正しい署名は通る（対象外のイベントは何もしない）", async () => {
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: {} } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await webhook.POST(
      new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } })
    );
    expect(res.status).toBe(200);
  });
});

describe("イベントで表が変わる", () => {
  it("completed → updated → deleted で status が追従する", async () => {
    const u = await newUser("billing-flow");
    await handleStripeEvent(event("checkout.session.completed", { subscription: "sub_1" + u.id }), async () =>
      sub(u, "sub_1" + u.id, "active")
    );
    expect((await getSubscriptionRow(u.id))?.status).toBe("active");
    expect((await getSubscriptionRow(u.id))?.currentPeriodEnd?.getTime()).toBe(1893456000000);

    await handleStripeEvent(updated("sub_1" + u.id), async () => sub(u, "sub_1" + u.id, "past_due"));
    expect((await getSubscriptionRow(u.id))?.status).toBe("past_due");

    await handleStripeEvent(event("customer.subscription.deleted", { id: "sub_1" + u.id }), async () =>
      sub(u, "sub_1" + u.id, "canceled")
    );
    expect((await getSubscriptionRow(u.id))?.status).toBe("canceled");
  });

  it("古い契約の解約通知で、有効な新しい契約を消さない", async () => {
    const u = await newUser("billing-old");
    await handleStripeEvent(updated("sub_new" + u.id), async () => sub(u, "sub_new" + u.id, "active"));
    await handleStripeEvent(updated("sub_old" + u.id), async () => sub(u, "sub_old" + u.id, "canceled"));
    expect((await getSubscriptionRow(u.id))?.stripeSubscriptionId).toBe("sub_new" + u.id);
  });

  it("user_id の無い契約は書かない", async () => {
    const u = await newUser("billing-nometa");
    const s = sub(u, "sub_nometa" + u.id, "active");
    s.metadata = {};
    await handleStripeEvent(updated(s.id), async () => s);
    expect(await getSubscriptionRow(u.id)).toBeNull();
  });
});

describe("上限の切り替え", () => {
  const now = new Date("2031-03-10T12:00:00+09:00");

  it("有料は 20/300、解約後は 5/30、本人は常に上限なし", async () => {
    expect(quotaLimits(true)).toMatchObject({ userDay: 20, userMonth: 300 });
    const u = await newUser("billing-limits");
    const me = { id: u.id, email: u.email };

    await handleStripeEvent(updated("sub_l" + u.id), async () => sub(u, "sub_l" + u.id, "active"));
    let usage = await getReceiptUsage(me, { now });
    expect(usage).toMatchObject({ paid: true, canUpgrade: false, canManage: true });
    expect(usage.day.limit).toBe(20);

    await handleStripeEvent(updated("sub_l" + u.id), async () => sub(u, "sub_l" + u.id, "canceled"));
    usage = await getReceiptUsage(me, { now });
    expect(usage).toMatchObject({ paid: false, canUpgrade: true });
    expect(usage.day.limit).toBe(5);

    process.env.OWNER_USER_IDS = u.id;
    usage = await getReceiptUsage(me, { now });
    expect(usage).toMatchObject({ unlimited: true, canUpgrade: false });
  });

  it("無料の上限超過は申し込みに案内する", async () => {
    const u = await newUser("billing-upgrade");
    const me = { id: u.id, email: u.email };
    for (let i = 0; i < 5; i++) await reserveReceiptParse(me, { now });
    expect(await reserveReceiptParse(me, { now })).toMatchObject({ ok: false, reason: "user_day", canUpgrade: true });
  });
});

describe("checkout", () => {
  const post = () => checkout.POST(new Request("http://x/api/stripe/checkout", { method: "POST" }));

  it("本人アカウントと有料の人は 409、未設定は 503", async () => {
    const u = await newUser("billing-checkout");
    signInAs({ id: u.id, email: u.email });
    process.env.OWNER_USER_IDS = u.id;
    expect((await post()).status).toBe(409);
    delete process.env.OWNER_USER_IDS;

    await handleStripeEvent(updated("sub_c" + u.id), async () => sub(u, "sub_c" + u.id, "active"));
    expect((await post()).status).toBe(409);

    delete process.env.STRIPE_PRICE_ID;
    expect((await post()).status).toBe(503);
  });
});
