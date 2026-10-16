/**
 * @file tests/e2e/definitions.spec.ts
 * @description W11・W12（mywork#425 第1弾 定義と透明性）。スマホ幅（375px）で
 *   W11 ダッシュボードに定義の脚注と「予定（今日より後）」が見え、「定義」のリンク先は未ログインでも読める
 *   W12 要確認に返金候補が出て、種類を「返金」に変えると支出が減る
 */

import { expect, test } from "@playwright/test";
import { FOOTNOTES } from "../../src/lib/aggregate/definitions";
import { createAccount, createUser, login, todayJst } from "./helpers";

/** 明日（JST）。月をまたぐときは null（この月の予定として見えないので確かめない） */
function tomorrowInSameMonth(today: string): string | null {
  const t = new Date(`${today}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  const d = t.toISOString().slice(0, 10);
  return d.slice(0, 7) === today.slice(0, 7) ? d : null;
}

test("W11 ダッシュボードに定義の脚注と予定が見える。定義のページは未ログインでも読める", async ({ page, browser }) => {
  const user = await createUser("w11");
  await login(page, user);
  const account = await createAccount(page);
  const today = todayJst();
  const tomorrow = tomorrowInSameMonth(today);

  const res = await page.request.post("/api/v1/transactions", {
    data: { account_id: account, amount: 1234, type: "expense", transaction_date: today, note: "昼ごはん" },
  });
  expect(res.status()).toBe(201);
  if (tomorrow) {
    const sched = await page.request.post("/api/v1/transactions", {
      data: { account_id: account, amount: 500, type: "expense", transaction_date: tomorrow, note: "先払い" },
    });
    expect(sched.status()).toBe(201);
  }

  await page.goto("/dashboard");
  await expect(page.getByTestId("expense-total")).toHaveText("-¥1,234");
  await expect(page.getByTestId("expense-footnote")).toHaveText(FOOTNOTES.expense);
  await expect(page.getByTestId("period-footnote")).toContainText(FOOTNOTES.period);
  if (tomorrow) {
    await expect(page.getByTestId("scheduled-expense")).toHaveText("-¥500");
    await expect(page.getByTestId("upcoming-list")).toContainText("先払い");
  }

  // 横にはみ出さない
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // 「定義」のリンク → 定義のページ
  await page.getByRole("link", { name: "定義" }).first().click();
  await page.waitForURL("**/about/definitions");
  await expect(page.getByRole("heading", { name: "数字の定義" })).toBeVisible();
  await expect(page.getByText("支出", { exact: true }).first()).toBeVisible();

  // 未ログインでも読める（ログインに飛ばされない）
  const anon = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const p = await anon.newPage();
  const r = await p.goto("/about/definitions");
  expect(r?.status()).toBe(200);
  expect(p.url()).toContain("/about/definitions");
  await expect(p.getByRole("heading", { name: "数字の定義" })).toBeVisible();
  await anon.close();
});

test("W12 要確認の返金候補を「返金」にすると支出が減る", async ({ page }) => {
  const user = await createUser("w12");
  await login(page, user);
  const account = await createAccount(page);
  const today = todayJst();
  const cats = (await (await page.request.get("/api/v1/categories?type=expense")).json()).data as { id: string; name: string }[];
  const food = cats.find((c) => c.name === "食費")!;

  // 食費 1,000 と、食費のカテゴリーなのに収入になっている 300（返金のつもりで入れた行）
  for (const data of [
    { account_id: account, category_id: food.id, amount: 1000, type: "expense", transaction_date: today, note: "スーパー" },
    { account_id: account, category_id: food.id, amount: 300, type: "income", transaction_date: today, note: "返品" },
  ]) {
    expect((await page.request.post("/api/v1/transactions", { data })).status()).toBe(201);
  }

  await page.goto("/dashboard");
  await expect(page.getByTestId("expense-total")).toHaveText("-¥1,000");
  await expect(page.getByTestId("review-count")).toContainText("1件");

  // メニューから要確認へ（ダッシュボードにも「要確認 N件」のカードがあるので、メニューの中のリンクを選ぶ）
  await page.getByRole("button", { name: "メニュー" }).click();
  await page.locator("#mobile-menu").getByRole("link", { name: /要確認/ }).click();
  await page.waitForURL("**/review");
  const candidate = page.getByTestId("refund-candidate").filter({ hasText: "返品" });
  await expect(candidate).toBeVisible();
  await expect(candidate).toContainText("¥300");
  await candidate.getByRole("button", { name: "返金にする" }).click();
  await expect(page.getByTestId("refund-candidate")).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.goto("/dashboard");
  await expect(page.getByTestId("expense-total")).toHaveText("-¥700");
  await expect(page.getByTestId("review-count")).toContainText("0件");
});
