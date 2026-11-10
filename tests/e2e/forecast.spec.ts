/**
 * @file tests/e2e/forecast.spec.ts
 * @description app#43 今月の収支に定期の見込みを先に入れる。スマホ幅（375px）で
 * 定期の給料・家賃（どちらも月末）を登録 → ダッシュボードが「見込み込み」で給料・家賃を足した数字になる →
 * 「実績のみ」で今までの数字に戻る → 先月は切り替えが出ず今までどおり、まで。数字は作った値だけ。
 */

import { expect, test } from "@playwright/test";
import { createAccount, createUser, login, todayJst } from "./helpers";

test("W-43 定期の給料・家賃を月末の支払日前から今月の収支に入れ、実績のみに切り替えられる", async ({ page }) => {
  const today = todayJst();
  const [y, m] = today.split("-").map(Number);
  // 月末当日は給料・家賃がもう取引（実績）になるので、見込みの確認はできない
  test.skip(Number(today.slice(8, 10)) === new Date(Date.UTC(y, m, 0)).getUTCDate(), "月末当日は見込みが無い");

  const user = await createUser("w43");
  await login(page, user);
  const account = await createAccount(page);

  // 今日の実績の支出 30,000円
  const tx = await page.request.post("/api/v1/transactions", {
    data: { account_id: account, amount: 30000, type: "expense", transaction_date: today, note: "食費" },
  });
  expect(tx.status()).toBe(201);
  // 月末（31日＝その月の最終日）の給料 200,000円・家賃 60,000円
  for (const fc of [
    { name: "給料", amount: 200000, type: "income" },
    { name: "家賃", amount: 60000, type: "expense" },
  ]) {
    const res = await page.request.post("/api/v1/fixed-costs", {
      data: { account_id: account, ...fc, cycle: "monthly", billing_day: 31 },
    });
    expect(res.status()).toBe(201);
  }

  await page.goto("/dashboard");
  // 見込み込み（既定）: 収入 200,000・支出 90,000・残り 110,000
  const toggle = page.getByTestId("forecast-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle.getByRole("button", { name: "見込み込み" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("income-total")).toHaveText("+¥200,000");
  await expect(page.getByTestId("expense-total")).toHaveText("-¥90,000");
  await expect(page.getByTestId("balance-total")).toHaveText("+¥110,000");
  await expect(page.getByTestId("forecast-card")).toContainText("2件");
  await expect(page.getByTestId("upcoming-list")).toContainText("定期・見込みに含む");
  // 月末の見込みは今までと同じ（実績の残り＋予定）。見込み込みにしても二重に足さない
  await expect(page.getByTestId("projected-balance")).toContainText("+¥110,000");

  // 実績のみ: 今までどおりの数字
  await toggle.getByRole("button", { name: "実績のみ" }).click();
  await expect(page.getByTestId("income-total")).toHaveText("+¥0");
  await expect(page.getByTestId("expense-total")).toHaveText("-¥30,000");
  await expect(page.getByTestId("balance-total")).toHaveText("-¥30,000");
  await expect(page.getByTestId("scheduled-expense")).toHaveText("-¥60,000");
  await expect(page.getByTestId("projected-balance")).toContainText("+¥110,000");

  // スマホで横にはみ出さない
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // 先月: 切り替えは出ず、見込みは足さない
  await page.getByRole("button", { name: "← 前月" }).click();
  await expect(page.getByTestId("income-total")).toHaveText("+¥0");
  await expect(page.getByTestId("forecast-toggle")).toHaveCount(0);
});
