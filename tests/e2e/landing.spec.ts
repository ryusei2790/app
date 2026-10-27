/**
 * @file tests/e2e/landing.spec.ts
 * @description 広告の着地ページ（mywork#878）。スマホ幅で、完了条件の URL から開いて事前登録し、
 * 社長の画面で utm_content=a の「開いた人1・登録1」と CSV の UTM を確かめる。ログイン済みは今までどおり /calendar。
 */

import { expect, test } from "@playwright/test";
import { E2E_OWNER_ID, createUser, login } from "./helpers";

const AD_URL = "/?utm_source=instagram&utm_medium=paid_social&utm_campaign=kakebo_test_2611&utm_content=a";

test("LP1 広告の URL → 着地ページ → 事前登録 → 社長の画面と CSV に UTM 付きで1件", async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const viewed = page.waitForResponse((r) => r.url().endsWith("/api/lp/view"));
  await page.goto(AD_URL);
  await expect(page).toHaveURL(/utm_content=a/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("打ち込まない家計簿");
  await viewed;

  const email = `lp-${Date.now()}@example.test`;
  const form = page.locator("#waitlist");
  await form.getByLabel("メールアドレス").fill(email);
  const submit = form.getByRole("button", { name: /お知らせを受け取る/ });
  await expect(submit).toBeDisabled();
  await form.getByRole("checkbox").check();
  await submit.click();
  await expect(page.getByRole("status")).toContainText("受け付けました");

  // 社長として集計を見る（別のブラウザ＝別の visitor）
  const ctx = await browser.newContext();
  const owner = await ctx.newPage();
  await login(owner, await createUser("lp-owner", E2E_OWNER_ID));
  await owner.goto("/settings/waitlist");
  const rowA = owner.getByTestId("waitlist-by-content").getByRole("row", { name: /^a / });
  await expect(rowA).toBeVisible();
  const csv = await (await owner.request.get("/api/v1/admin/waitlist")).text();
  expect(csv).toContain(`${email},instagram,paid_social,kakebo_test_2611,a`);
  await ctx.close();
});

test("LP2 社長以外は事前登録の画面も CSV も見られない", async ({ page }) => {
  await login(page, await createUser("lp-other"));
  expect((await page.goto("/settings/waitlist"))?.status()).toBe(404);
  expect((await page.request.get("/api/v1/admin/waitlist")).status()).toBe(403);
});

test("LP3 ログイン済みで / を開くと今までどおりカレンダー", async ({ page }) => {
  await login(page, await createUser("lp-in"));
  await page.goto("/");
  await expect(page).toHaveURL(/\/calendar/);
});
