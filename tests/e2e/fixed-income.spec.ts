/**
 * @file tests/e2e/fixed-income.spec.ts
 * @description W9（mywork#229 固定の収入・支出）。スマホ幅（375px）で
 * メニュー「定期の収入・支出」→ 仕送り（条件付き）と給料を登録 → 一覧に「固定として数えた取引」→
 * ダッシュボードに「固定の収入」と「今月の予定（未確定）」が出るまで。
 */

import { expect, test } from "@playwright/test";
import { createAccount, createUser, login, todayJst } from "./helpers";

test("W9 定期の収入を登録すると、過去の取引が固定として数えられ、今月の予定が出る", async ({ page }) => {
  const user = await createUser("w9");
  await login(page, user);
  const account = await createAccount(page);
  const today = todayJst();

  // CSV で入れたつもりの今月の仕送り（メモ付き）
  const tx = await page.request.post("/api/v1/transactions", {
    data: { account_id: account, amount: 130000, type: "income", transaction_date: today, note: "仕送り" },
  });
  expect(tx.status()).toBe(201);

  // メニューの名前で、収入も入る場所だと分かる
  await page.getByRole("button", { name: "メニュー" }).click();
  await page.getByRole("link", { name: /定期の収入・支出/ }).click();
  await expect(page.getByRole("heading", { name: "定期の収入・支出" })).toBeVisible();

  // 仕送り: メモに「仕送り」があれば固定として数える
  await page.getByRole("button", { name: "+ 追加" }).click();
  await page.getByLabel("種別").selectOption("income");
  await page.getByLabel("名前 *").fill("仕送り");
  await page.getByLabel("金額（円）*").fill("130000");
  await page.getByLabel(/支払日/).selectOption("27");
  await page.getByLabel("口座 *").selectOption({ label: "財布" });
  // メモの語句は名前から自動で入る
  await expect(page.getByLabel("メモに含まれる語句")).toHaveValue("仕送り");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const item = page.getByTestId("fixed-cost-item").filter({ hasText: "仕送り" });
  await expect(item.getByTestId("matched-count")).toContainText("固定として数えた 1件");

  // 給料（月末）: まだ取引が無いので「今月の予定」に出る
  await page.getByRole("button", { name: "+ 追加" }).click();
  await page.getByLabel("種別").selectOption("income");
  await page.getByLabel("名前 *").fill("給料");
  await page.getByLabel("金額（円）*").fill("30000");
  await page.getByLabel(/支払日/).selectOption("31");
  await page.getByLabel("口座 *").selectOption({ label: "財布" });
  await page.getByLabel("メモに含まれる語句").fill("給料");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("fixed-cost-item")).toHaveCount(2);

  await page.goto("/dashboard");
  await expect(page.getByTestId("fixed-income")).toHaveText("+¥130,000");
  await expect(page.getByTestId("variable-expense")).toHaveText("-¥0");

  // 月末当日は給料がもう取引になっているので、予定は出ない
  const [y, m] = today.split("-").map(Number);
  const isMonthEnd = Number(today.slice(8, 10)) === new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (!isMonthEnd) {
    const upcoming = page.getByTestId("upcoming-list");
    await expect(upcoming).toContainText("給料");
    await expect(upcoming).toContainText("+¥30,000");
    await expect(page.getByTestId("projected-balance")).toContainText("+¥160,000");
  }

  // スマホで横にはみ出さない
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
