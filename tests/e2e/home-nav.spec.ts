/**
 * @file tests/e2e/home-nav.spec.ts
 * @description ホームへの動線（mywork#1238 第1弾）。スマホ幅（375px）で、どの画面からも1回でホーム（/start）に戻れるか。
 *   H1 左上のアプリ名を押すとホーム
 *   H2 下のタブはどの画面にも出て、「ホーム」でホームに戻る。いまの画面のタブが光る
 *   H3 メニューの先頭に「ホーム」
 *   H4 質問して集計の入力欄が下のタブに重ならない・横にはみ出さない
 */

import { expect, test } from "@playwright/test";
import { createUser, login } from "./helpers";

test("H1〜H4 スマホ幅でどの画面からもホームに戻れる", async ({ page }) => {
  const user = await createUser("home");
  await login(page, user);

  // H1 左上のアプリ名（標準3つの画面・拡張機能の画面・設定から）
  for (const path of ["/closing", "/calendar", "/settings"]) {
    await page.goto(path);
    await page.getByRole("link", { name: "カレンダー家計簿（ホームへ）" }).click();
    await page.waitForURL("**/start");
    await expect(page.getByTestId("standard-features")).toBeVisible();
  }

  // H2 下のタブ
  const tabs = page.getByTestId("tab-bar");
  for (const path of ["/entry", "/receipts/new", "/transactions", "/chat"]) {
    await page.goto(path);
    await expect(tabs).toBeVisible();
    await tabs.getByRole("link", { name: /ホーム/ }).click();
    await page.waitForURL("**/start");
  }
  await page.goto("/closing");
  await expect(tabs.getByRole("link", { name: /決算/ })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: /ホーム/ })).not.toHaveAttribute("aria-current", "page");
  // タブは画面の中に収まっている（Safari のツールバーの裏に隠れない＝見えている高さの中）
  const box = await tabs.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);

  // H3 メニューの先頭
  await page.getByRole("button", { name: "メニュー" }).click();
  const first = page.locator("#mobile-menu li").first();
  await expect(first).toHaveText(/ホーム/);
  await first.getByRole("link").click();
  await page.waitForURL("**/start");

  // H4 質問して集計: 入力欄がタブの上にあり、重ならない
  await page.goto("/ask");
  const form = page.getByRole("textbox", { name: "質問" });
  const f = await form.boundingBox();
  const t = await tabs.boundingBox();
  expect(f!.y + f!.height).toBeLessThanOrEqual(t!.y);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
