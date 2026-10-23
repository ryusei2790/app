/**
 * @file tests/e2e/subscriptions.spec.ts
 * @description W13（mywork#742 ② サブスク管理）。スマホ幅（390px）で
 * 定期の画面 → 「サブスク一覧 →」→「+ 追加」でサブスクを1件追加（管理欄つき）→ 一覧に月額・次回更新日・URL ボタン →
 * 編集で次回更新日を手入力 → 止めると「止めているもの」に移り合計から外れる、まで。家賃（サブスクでない）は一覧に出ない。
 */

import { expect, test } from "@playwright/test";
import { createAccount, createUser, login, todayJst } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

/** "YYYY-MM-DD" に n 日足す（UTC の日付計算なので TZ に左右されない） */
function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

test("W13 サブスクを追加すると一覧に月額・次回更新日・管理/解約ボタンが出て、止めると合計から外れる", async ({ page }) => {
  const user = await createUser("w12");
  await login(page, user);
  const account = await createAccount(page);
  const today = todayJst();

  // サブスクではない定期（家賃）は一覧に出ない
  const rent = await page.request.post("/api/v1/fixed-costs", {
    data: { account_id: account, name: "家賃", amount: 80000, billing_day: 27 },
  });
  expect(rent.status()).toBe(201);

  await page.goto("/fixed-costs");
  await page.getByRole("link", { name: "サブスク一覧 →" }).click();
  await expect(page.getByRole("heading", { name: "サブスク" })).toBeVisible();
  await expect(page.getByTestId("subscription-item")).toHaveCount(0);

  // 「+ 追加」→ 定期の画面のフォームがサブスクにチェック済みで開く
  await page.getByRole("link", { name: "+ 追加" }).click();
  await expect(page.getByLabel("サブスク（サブスク一覧に出す）")).toBeChecked();
  await page.getByLabel("名前 *").fill("Netflix");
  await page.getByLabel("金額（円）*").fill("1590");
  await page.getByLabel(/支払日/).selectOption("3");
  await page.getByLabel("口座 *").selectOption({ label: "財布" });
  await page.getByLabel("管理ページの URL").fill("https://www.netflix.com/account");
  await page.getByLabel("支払いカード").fill("楽天カード VISA");
  await page.getByLabel("メモ（自由記入）").fill("ベーシック");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  // 一覧から来たので、保存すると一覧へ戻る
  await expect(page.getByRole("heading", { name: "サブスク" })).toBeVisible();
  await page.goto("/fixed-costs");
  await expect(page.getByTestId("fixed-cost-item").filter({ hasText: "Netflix" })).toContainText("サブスク");

  // カード番号は保存できない
  await page.getByRole("button", { name: "+ 追加" }).click();
  await page.getByLabel("名前 *").fill("x");
  await page.getByLabel("金額（円）*").fill("100");
  await page.getByLabel("口座 *").selectOption({ label: "財布" });
  await page.getByLabel("サブスク（サブスク一覧に出す）").check();
  await page.getByLabel("支払いカード").fill("4111 1111 1111 1111");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  // Next のルート告知（#__next-route-announcer__）も role=alert なので、文言で探す
  await expect(page.getByText("支払いカードにはカード番号を入れないでください")).toBeVisible();
  await page.getByRole("button", { name: "キャンセル" }).click();

  // 一覧: 月あたり・件数・URL ボタン（新しいタブ）・解約URL 未設定
  await page.getByRole("link", { name: "サブスク一覧 →" }).click();
  const item = page.getByTestId("subscription-item").filter({ hasText: "Netflix" });
  await expect(page.getByTestId("subscription-item")).toHaveCount(1);
  await expect(page.getByTestId("subscription-monthly")).toHaveText("¥1,590");
  await expect(page.getByTestId("subscription-totals")).toContainText("年あたり ¥19,080 ・ 1件");
  await expect(item).toContainText("¥1,590/月");
  await expect(item).toContainText("楽天カード VISA");
  const manage = item.getByRole("link", { name: "Netflixの管理ページを開く" });
  await expect(manage).toHaveAttribute("href", "https://www.netflix.com/account");
  await expect(manage).toHaveAttribute("target", "_blank");
  await expect(manage).toHaveAttribute("rel", "noopener noreferrer");
  await expect(item).toContainText("解約・変更未設定");
  // ボタンは指で押せる高さ（44px 以上）
  expect((await manage.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // 編集 → 定期の画面の編集フォームが開く。次回更新日を5日後に手入力 → 7日以内なので色付き・「手入力」
  await item.getByRole("link", { name: "Netflixを編集" }).click();
  await expect(page.getByRole("heading", { name: "定期を編集" })).toBeVisible();
  await expect(page.getByLabel("管理ページの URL")).toHaveValue("https://www.netflix.com/account");
  await page.getByLabel("次回更新日（任意）").fill(addDays(today, 5));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/subscriptions$/);
  await expect(item.getByTestId("renewal")).toContainText("あと5日）・手入力");

  // スマホで横にはみ出さない
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // 止める → 「止めているもの」に移り、合計から外れる
  await page.goto("/fixed-costs");
  await page.getByRole("switch", { name: "Netflixを一時停止" }).click();
  await expect(page.getByRole("switch", { name: "Netflixを再開" })).toBeVisible();
  await page.getByRole("link", { name: "サブスク一覧 →" }).click();
  await expect(page.getByRole("region", { name: "止めているもの" })).toContainText("Netflix");
  await expect(page.getByTestId("subscription-monthly")).toHaveText("¥0");
});
