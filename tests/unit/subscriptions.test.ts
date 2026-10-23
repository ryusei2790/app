/**
 * @file tests/unit/subscriptions.test.ts
 * @description サブスク管理（mywork#742 ②、設計書 docs/2026-10-23_サブスク管理_設計.md §1・§2・§5）の単体テスト。
 * - SB1 管理欄の入力ルール（URL の形・長さ・カード番号らしき数字・空文字→NULL・既定値）
 * - SB2 次回更新日の決め方（手入力が未来なら手入力・過ぎたら自動・止めているものは無し）
 * - SB3 一覧の並び（次回更新日の昇順・止めているものは最後）と月/年の合計（相場なしのドル建ては外す）
 */

import { describe, expect, it } from "vitest";
import { parseFixedCostInput } from "@/lib/validation/fixed-cost";
import { buildSubscriptionList, renewalOf, type SubscriptionSource } from "@/lib/subscriptions/list";

const base = { name: "Netflix", amount: 1590, billing_day: 3 };
const create = (extra: Record<string, unknown>) => parseFixedCostInput({ ...base, ...extra }, "create", "2026-10-23");

describe("SB1 管理欄の入力ルール", () => {
  it("何も送らなければサブスクではなく、管理欄は全部 NULL（既存の定期と同じ）", () => {
    const r = create({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      isSubscription: false, manageUrl: null, cancelUrl: null, nextRenewalDate: null, paymentCard: null, memo: null,
    });
  });

  it("6項目を受け付け、前後の空白を落とす", () => {
    const r = create({
      is_subscription: true,
      manage_url: " https://www.netflix.com/account ",
      cancel_url: "HTTPS://www.netflix.com/cancelplan",
      next_renewal_date: "2026-11-03",
      payment_card: " 楽天カード VISA ",
      memo: "ベーシック",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      isSubscription: true,
      manageUrl: "https://www.netflix.com/account",
      cancelUrl: "HTTPS://www.netflix.com/cancelplan",
      nextRenewalDate: "2026-11-03",
      paymentCard: "楽天カード VISA",
      memo: "ベーシック",
    });
  });

  it("空文字は NULL にする（欄を消す）", () => {
    const r = parseFixedCostInput({ manage_url: "", cancel_url: "  ", next_renewal_date: "", payment_card: "", memo: "" }, "update", "2026-10-23");
    expect(r.ok && r.value).toMatchObject({ manageUrl: null, cancelUrl: null, nextRenewalDate: null, paymentCard: null, memo: null });
  });

  it.each([
    ["javascript:alert(1)"],
    ["ftp://example.com"],
    ["www.netflix.com"],
    ["https://exa mple.com"],
    [`https://example.com/${"a".repeat(2000)}`],
  ])("http(s) で始まらない・形の壊れた・2000字を超える URL は弾く: %s", (url) => {
    expect(create({ manage_url: url }).ok).toBe(false);
    expect(create({ cancel_url: url }).ok).toBe(false);
  });

  it.each([["4111111111111111"], ["4111 1111 1111 1111"], ["4111-1111-1111-1111"], ["カード 123456789012"]])(
    "カード番号らしき数字（空白・ハイフンを除いて12桁以上）は弾く: %s",
    (card) => {
      const r = create({ payment_card: card });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("カード番号");
    }
  );

  it("下4桁などの短い数字は入れてよい・50字を超えると弾く", () => {
    expect(create({ payment_card: "楽天カード VISA 下4桁1234" }).ok).toBe(true);
    expect(create({ payment_card: "あ".repeat(51) }).ok).toBe(false);
  });

  it("メモは500字まで・次回更新日は日付の形・サブスクは true/false", () => {
    expect(create({ memo: "あ".repeat(500) }).ok).toBe(true);
    expect(create({ memo: "あ".repeat(501) }).ok).toBe(false);
    expect(create({ next_renewal_date: "2026/11/03" }).ok).toBe(false);
    expect(create({ is_subscription: "yes" }).ok).toBe(false);
  });
});

const src = (s: Partial<SubscriptionSource>): SubscriptionSource => ({
  id: "x",
  name: "x",
  amount: 1000,
  currency: "JPY",
  amount_yen: 1000,
  cycle: "monthly",
  is_active: true,
  is_subscription: true,
  next_date: "2026-11-03",
  next_renewal_date: null,
  ...s,
});

describe("SB2 次回更新日の決め方", () => {
  const today = "2026-10-23";

  it("手入力が今日以降なら手入力の日（manual）", () => {
    expect(renewalOf(src({ next_renewal_date: "2027-01-15" }), today)).toEqual({ date: "2027-01-15", manual: true });
    expect(renewalOf(src({ next_renewal_date: today }), today)).toEqual({ date: today, manual: true });
  });

  it("手入力が過ぎた・空なら、支払日の規則からの次の支払日（自動）", () => {
    expect(renewalOf(src({ next_renewal_date: "2026-10-01" }), today)).toEqual({ date: "2026-11-03", manual: false });
    expect(renewalOf(src({}), today)).toEqual({ date: "2026-11-03", manual: false });
  });

  it("止めている・終わったものは無し", () => {
    expect(renewalOf(src({ is_active: false, next_date: null, next_renewal_date: "2027-01-15" }), today)).toEqual({ date: null, manual: false });
    expect(renewalOf(src({ next_date: null }), today)).toEqual({ date: null, manual: false });
  });
});

describe("SB3 一覧の並びと合計", () => {
  const today = "2026-10-23";

  it("サブスクだけ・次回更新日の昇順・止めているものは最後・7日以内に印", () => {
    const list = buildSubscriptionList(
      [
        src({ id: "rent", name: "家賃", is_subscription: false, next_date: "2026-10-25" }),
        src({ id: "nf", name: "Netflix", next_date: "2026-11-03" }),
        src({ id: "gpt", name: "ChatGPT", next_date: "2026-10-25" }),
        src({ id: "sp", name: "Spotify", is_active: false, next_date: null }),
        src({ id: "yr", name: "年払い", cycle: "yearly", amount: 12000, amount_yen: 12000, next_date: "2027-03-01", next_renewal_date: "2026-10-30" }),
      ],
      today
    );
    expect(list.active.map((r) => [r.id, r.renewal, r.days_left, r.soon])).toEqual([
      ["gpt", "2026-10-25", 2, true],
      ["yr", "2026-10-30", 7, true],
      ["nf", "2026-11-03", 11, false],
    ]);
    expect(list.stopped.map((r) => r.id)).toEqual(["sp"]);
  });

  it("月あたり＝動いているものの月換算の合計、年あたり＝月×12。止めているもの・家賃は入れない", () => {
    const list = buildSubscriptionList(
      [
        src({ id: "a", amount_yen: 1590 }),
        src({ id: "b", cycle: "yearly", amount: 12000, amount_yen: 12000 }),
        src({ id: "c", is_active: false, next_date: null, amount_yen: 9999 }),
        src({ id: "d", is_subscription: false, amount_yen: 80000 }),
      ],
      today
    );
    expect(list.monthly_total).toBe(1590 + 1000);
    expect(list.yearly_total).toBe((1590 + 1000) * 12);
    expect(list.count).toBe(2);
    expect(list.missing_rate).toBe(0);
  });

  it("相場が取れないドル建ては合計から外し、件数を missing_rate に出す", () => {
    const list = buildSubscriptionList(
      [src({ id: "a", amount_yen: 1590 }), src({ id: "c", currency: "USD", amount: 20, amount_yen: null })],
      today
    );
    expect(list.monthly_total).toBe(1590);
    expect(list.count).toBe(2);
    expect(list.missing_rate).toBe(1);
  });
});
