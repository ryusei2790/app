/**
 * @file tests/unit/fx-usd-jpy.test.ts
 * @description ドル建ての定期（Issue #229 残り②）の純粋関数: 相場の取り出し・円への換算・入力ルール。
 */

import { describe, expect, it } from "vitest";
import { parseRate, usdToYen } from "@/lib/fx/usd-jpy";
import { parseFixedCostInput, checkRule } from "@/lib/validation/fixed-cost";
import { conditionFromRecord } from "@/lib/fixed-costs/expand";

describe("ドル円の相場", () => {
  it("Frankfurter の応答から JPY を取り出す。形が違えば null", () => {
    expect(parseRate({ amount: 1, base: "USD", date: "2026-10-16", rates: { JPY: 151.23 } })).toBe(151.23);
    expect(parseRate({ rates: {} })).toBeNull();
    expect(parseRate({ rates: { JPY: "151" } })).toBeNull();
    expect(parseRate(null)).toBeNull();
  });

  it("ドル→円は1円未満を四捨五入", () => {
    expect(usdToYen(110, 151.23)).toBe(16635);
    expect(usdToYen(22, 149.5)).toBe(3289);
    expect(usdToYen(9.99, 150)).toBe(1499);
  });
});

describe("ドル建ての定期の入力", () => {
  const base = { account_id: "a", name: "Claude Max", amount: 110, billing_day: 18 };

  it("通貨の既定は JPY、USD を受け付ける", () => {
    const jpy = parseFixedCostInput(base, "create", "2026-10-20");
    expect(jpy.ok && jpy.value.currency).toBe("JPY");
    const usd = parseFixedCostInput({ ...base, currency: "USD" }, "create", "2026-10-20");
    expect(usd.ok && usd.value.currency).toBe("USD");
  });

  it("USD はセント（小数2桁）まで、JPY は整数だけ", () => {
    expect(parseFixedCostInput({ ...base, amount: 9.99, currency: "USD" }, "create", "2026-10-20").ok).toBe(true);
    expect(parseFixedCostInput({ ...base, amount: 9.999, currency: "USD" }, "create", "2026-10-20").ok).toBe(false);
    expect(parseFixedCostInput({ ...base, amount: 9.99 }, "create", "2026-10-20").ok).toBe(false);
    expect(parseFixedCostInput({ ...base, amount: 0, currency: "USD" }, "create", "2026-10-20").ok).toBe(false);
  });

  it("JPY・USD 以外の通貨は 422 相当", () => {
    expect(parseFixedCostInput({ ...base, currency: "EUR" }, "create", "2026-10-20").ok).toBe(false);
  });

  it("更新で円に戻すときに小数の金額が残っていれば止める", () => {
    const r = checkRule({
      name: "x", amount: 9.99, type: "expense", cycle: "monthly", billingDay: 1, billingMonth: null,
      startDate: "2026-10-01", endDate: null, isActive: true, matchNote: null, matchAnyAmount: false, currency: "JPY",
    });
    expect(r.ok).toBe(false);
  });

  it("ドル建ての定期は固定の判定で金額を見ない（円が毎回変わるため）", () => {
    const c = conditionFromRecord({
      id: "f", type: "expense", categoryId: null, amount: 110, matchNote: "Claude", matchAnyAmount: false, currency: "USD",
    });
    expect(c.matchAnyAmount).toBe(true);
  });
});
