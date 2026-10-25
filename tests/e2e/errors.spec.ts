/**
 * @file tests/e2e/errors.spec.ts
 * @description W14（mywork#764 ③ エラー時の画面）。スマホ幅（390px）で
 * 無い URL → 日本語の「ページが見つかりません」からホームへ戻れる／
 * API が中身の無い 500 → 「サーバーで問題」と「もう一度」→ 直ったら押すと一覧が出る／
 * 通信が切れた → 「通信できませんでした」、まで。英語のエラー文が画面に出ないこと。
 */

import { expect, test } from "@playwright/test";
import { createAccount, createUser, login } from "./helpers";
import { MESSAGES } from "../../src/lib/errors/api-error";

test.use({ viewport: { width: 390, height: 844 } });

test("W14 無い URL・API の 500・通信切れで日本語の説明と「もう一度」が出て、押すと戻る", async ({ page }) => {
  const user = await createUser("w14");
  await login(page, user);
  await createAccount(page);

  // 無い URL
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  await page.screenshot({ path: "test-results/w14-not-found.png" });
  await page.getByRole("link", { name: "ホームへ戻る" }).click();
  await expect(page).toHaveURL(/\/calendar/);

  // API が中身の無い 500（DB が落ちたとき）
  await page.route("**/api/v1/fixed-costs", (r) => r.fulfill({ status: 500, body: "" }));
  await page.goto("/subscriptions");
  const alert = page.getByRole("alert").filter({ hasText: MESSAGES.server });
  await expect(alert).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/JSON|Unexpected|Internal Server Error/);
  await page.screenshot({ path: "test-results/w14-server-error.png" });
  // 直ったあと「もう一度」で一覧が出る
  await page.unroute("**/api/v1/fixed-costs");
  await alert.getByRole("button", { name: "もう一度" }).click();
  await expect(alert).toHaveCount(0); // Next の画面読み上げ用の空の alert があるので文言で見る
  await expect(page.getByRole("heading", { name: "サブスク" })).toBeVisible();

  // 通信が切れた（圏外）
  await page.route("**/api/v1/fixed-costs", (r) => r.abort("internetdisconnected"));
  await page.goto("/fixed-costs");
  await expect(page.getByRole("alert").filter({ hasText: MESSAGES.network })).toBeVisible();
  await page.screenshot({ path: "test-results/w14-network-error.png" });
});
