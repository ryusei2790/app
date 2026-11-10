/**
 * @file tests/e2e/flows.spec.ts
 * @description テスト一覧 F の W3〜W6。スマホ幅（375px、playwright.config.ts）で主な導線が通るか。
 * レシートの AI はモック（RECEIPT_PARSER=mock）。
 */

import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { createAccount, createUser, login } from "./helpers";
import { toDraft } from "../../src/lib/receipt/schema";
import exclusiveTax from "../fixtures/receipts/exclusive-tax.json";

test("W3 スマホ幅で 取引を追加 → 一覧に出る → 月の合計に入る", async ({ page }) => {
  const user = await createUser("w3");
  await login(page, user);
  await createAccount(page);
  await page.goto("/calendar");

  // 横にはみ出さない（スマホで横スクロールが出ない）
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.locator('button[aria-current="date"]').click();
  await page.getByRole("button", { name: "+ 収支を追加" }).click();
  await page.getByLabel("金額（円）").fill("1234");
  await page.getByLabel("口座 *").selectOption({ label: "財布" });
  await page.getByLabel("メモ").fill("昼ごはん");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.keyboard.press("Escape");

  // 一覧へはメニューから移動する（スマホではサイドバーを畳んでいる）
  await page.getByRole("button", { name: "メニュー" }).click();
  await page.getByRole("link", { name: /収支一覧/ }).click();
  await page.waitForURL("**/transactions");
  await expect(page.getByText("昼ごはん")).toBeVisible();
  await expect(page.getByText("支出 -¥1,234")).toBeVisible();
});

test("W4 レシートを撮る → 確認 → 保存（送る前に縮小される）", async ({ page }) => {
  const user = await createUser("w4");
  await login(page, user);
  await createAccount(page);
  await page.goto("/receipts/new");

  // 初回の同意
  await page.getByLabel("上の内容に同意します").check();
  await page.getByRole("button", { name: "同意して始める" }).click();
  await expect(page.getByTestId("receipt-remaining")).toHaveText(/今日あと 5 枚/);

  // スマホのカメラ並みに大きい写真（4032×3024・数MB）を選ぶ
  const big = await sharp({
    create: { width: 4032, height: 3024, channels: 3, background: "#fff", noise: { type: "gaussian", mean: 128, sigma: 60 } },
  }).jpeg({ quality: 95 }).toBuffer();
  expect(big.length).toBeGreaterThan(2 * 1024 * 1024);

  const uploaded = page.waitForRequest((r) => r.url().endsWith("/api/v1/receipts/parse"));
  await page.getByLabel("レシートの写真").setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: big });
  const req = await uploaded;
  await req.response();
  // 送った本文の大きさ（multipart 全体）。元の写真は 2MB 超なので、縮小されていなければここで超える
  expect((await req.sizes()).requestBodySize).toBeLessThan(2 * 1024 * 1024);

  // 確認画面（モックの内容）→ 合計を直して保存
  await expect(page.getByLabel("店名")).toHaveValue("ファミリーマート 青山店");
  await expect(page.getByLabel("合計（円）")).toHaveValue("598");
  await expect(page.getByLabel("消費税の確認")).toHaveText(/内税: 小計と合計が一致（¥598・うち消費税 ¥44）/);
  await page.getByLabel("合計（円）").fill("600");
  // 明細ごとのカテゴリ（AI の案＝食費）。1行を日用品に直すと、2件に分けて登録される（mywork#229）
  await expect(page.getByLabel("おにぎり 鮭 のカテゴリ")).toHaveValue(/.+/);
  await page.getByLabel("お茶 500ml のカテゴリ").selectOption({ label: "日用品" });
  await expect(page.getByLabel("保存される取引")).toHaveText(/食費 ¥400 \/ 日用品 ¥200 の 2 件/);
  if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/receipt-review.png`, fullPage: true });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
  await expect(page.getByTestId("receipt-remaining")).toHaveCount(0);

  await page.getByRole("link", { name: "収支一覧へ" }).click();
  // 一覧の種別バッジ（スマホ幅で畳んでいるメニューの「レシート」とは別）
  await expect(page.getByText("レシート", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("¥600").first()).toBeVisible();
});

/**
 * 読み取りの応答だけ、指定の AI 応答（作った数字）から作った下書きに差し替える（app#42）。
 * 回数の記録・画像の検査はサーバー（モック）を通し、draft だけを toDraft の結果にする。
 */
async function routeParseWith(page: Page, aiResult: unknown) {
  await page.route("**/api/v1/receipts/parse", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.data.draft = toDraft(JSON.stringify(aiResult), new Date().toISOString().slice(0, 10));
    await route.fulfill({ response: res, json });
  });
}

async function startReceipt(page: Page, name: string) {
  const user = await createUser(name);
  await login(page, user);
  await createAccount(page);
  await page.goto("/receipts/new");
  await page.getByLabel("上の内容に同意します").check();
  await page.getByRole("button", { name: "同意して始める" }).click();
  const small = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  await page.getByLabel("レシートの写真").setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: small });
}

test("W4b 外税のレシート（小計＋消費税＝合計）は税込の合計で登録される（app#42）", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  // AI が「分からない」と答えても、金額の整合で外税と決まる
  await routeParseWith(page, { ...exclusiveTax, purchased_at: today, tax_mode: "unknown" });
  await startReceipt(page, "w4b");

  await expect(page.getByLabel("合計（円）")).toHaveValue("1327");
  await expect(page.getByLabel("消費税の確認")).toHaveText("外税: 小計 ¥1,222 ＋ 消費税 ¥105 ＝ 合計 ¥1,327（税込の合計を登録）");
  await expect(page.getByLabel("確認してほしい点")).toHaveCount(0);
  await expect(page.getByLabel("保存される取引")).toHaveText(/食費 ¥\d.* \/ 日用品 ¥416 の 2 件/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/receipt-exclusive.png`, fullPage: true });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存しました")).toBeVisible();

  await page.getByRole("link", { name: "収支一覧へ" }).click();
  await expect(page.getByText("支出 -¥1,327")).toBeVisible();
});

test("W4c 小計＋消費税でも合計と合わないレシートは確認へ（合計は読めた値のまま・app#42）", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await routeParseWith(page, { ...exclusiveTax, purchased_at: today, total: 1400 });
  await startReceipt(page, "w4c");

  await expect(page.getByLabel("合計（円）")).toHaveValue("1400");
  await expect(page.getByLabel("確認してほしい点")).toContainText("小計（1,222円）＋消費税（105円）と合計（1,400円）が合いません");
  await expect(page.getByLabel("消費税の確認")).toHaveCount(0);
  if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/receipt-mismatch.png`, fullPage: true });
});

test("W5 定期支出を 登録 → 一覧 → 編集 → 一時停止", async ({ page }) => {
  const user = await createUser("w5");
  await login(page, user);
  await createAccount(page);
  await page.goto("/fixed-costs");

  await page.getByRole("button", { name: "+ 追加" }).click();
  await page.getByLabel("名前 *").fill("動画サブスク");
  await page.getByLabel("金額（円）*").fill("990");
  await page.getByLabel("周期").selectOption("monthly");
  await page.getByLabel(/支払日/).selectOption("28");
  await page.getByLabel("口座 *").selectOption({ label: "財布" });
  await page.getByRole("button", { name: "保存", exact: true }).click();

  const item = page.getByTestId("fixed-cost-item").filter({ hasText: "動画サブスク" });
  await expect(item).toContainText("毎月28日");
  await expect(item.getByTestId("next-date")).toContainText("次回");
  await expect(page.getByTestId("monthly-expense-total")).toHaveText("¥990");

  await item.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("金額（円）*").fill("1490");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(item).toContainText("¥1,490");

  await item.getByRole("switch", { name: "動画サブスクを一時停止" }).click();
  await expect(item.getByTestId("next-date")).toHaveText("停止中");
  await expect(page.getByTestId("monthly-expense-total")).toHaveText("¥0");
});

test("W6 新規登録・ログイン・ログアウト、未ログインは保護ページからログインへ", async ({ page }) => {
  // 未ログインで保護ページ → ログインへ
  for (const p of ["/calendar", "/transactions", "/fixed-costs", "/receipts/new"]) {
    await page.goto(p);
    await expect(page).toHaveURL(/\/login$/);
  }

  // 新規登録
  const email = `w6-${Date.now()}@example.test`;
  await page.goto("/signup");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel(/パスワード/).fill("password-w6");
  await page.getByRole("button", { name: "アカウントを作成" }).click();
  await page.waitForURL(/\/(calendar|login)$/);

  // ログイン（新規登録でそのまま入れた場合は一度ログアウトしてから）
  if (page.url().endsWith("/calendar")) {
    await page.getByRole("button", { name: "メニュー" }).click();
    await page.getByRole("button", { name: "ログアウト" }).click();
    await page.waitForURL("**/login");
  }
  await login(page, { email, password: "password-w6" });

  // ログアウト
  await page.getByRole("button", { name: "メニュー" }).click();
  await page.getByRole("button", { name: "ログアウト" }).click();
  await page.waitForURL("**/login");
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/login$/);
});
