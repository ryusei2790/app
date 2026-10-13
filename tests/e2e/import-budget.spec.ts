/**
 * @file tests/e2e/import-budget.spec.ts
 * @description テスト一覧 W7・W8。スマホ幅（375px）で
 *   W7 家計簿アプリの CSV を選ぶ → 内容を確認 → 予定の行を1つ外す → 取り込む → 取引一覧に出る
 *   W8 社長が /budget で今月の8費目・食費の1日目安・推移を見て、対応表を直すと表示が変わる
 * CSV は作り物（tests/fixtures/csv/kakebo_dummy.csv）。予定の行は 2099 年。
 * 社長は playwright.config.ts の OWNER_USER_IDS（E2E_OWNER_ID）と同じ id で作る。
 */

import path from "node:path";
import { expect, test } from "@playwright/test";
import { createUser, E2E_OWNER_ID, login } from "./helpers";

const DUMMY = path.resolve(__dirname, "../fixtures/csv/kakebo_dummy.csv");

test("W7 CSV を選ぶ → 内容を確認 → 予定を1つ外す → 取り込む → 取引一覧に出る", async ({ page }) => {
  const user = await createUser("w7");
  await login(page, user);
  await page.goto("/import");

  await page.getByLabel("CSVファイル").setInputFiles(DUMMY);
  await expect(page.getByTestId("import-format")).toHaveText(/家計簿アプリ/);
  await page.getByRole("button", { name: "内容を確認" }).click();

  // 内訳: 新規 6・予定 2・読めない行 0
  await expect(page.getByTestId("import-counts")).toContainText("新規 6件");
  await expect(page.getByTestId("import-counts")).toContainText("予定 2件");

  // 予定の行（初期値は全部「定期にする」）から給料だけ外す
  const salary = page.getByRole("checkbox", { name: /給料/ });
  await expect(salary).toBeChecked();
  await salary.uncheck();
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByTestId("import-result")).toContainText("6件を取り込みました");
  await expect(page.getByTestId("import-result")).toContainText("定期 1件");

  // 横にはみ出さない
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // 2026年9月の取引に入っている（画面の月送りは今日に依存するので API で見る）
  const list = await (await page.request.get("/api/v1/transactions?year=2026&month=9")).json();
  expect(list.data.filter((t: { note: string | null }) => t.note === "パン")).toHaveLength(2);

  // もう一度同じ CSV を確認すると新規 0件
  await page.goto("/import");
  await page.getByLabel("CSVファイル").setInputFiles(DUMMY);
  await page.getByRole("button", { name: "内容を確認" }).click();
  await expect(page.getByTestId("import-counts")).toContainText("新規 0件");
});

test("W8 /budget で費目・食費の1日目安・推移が見え、対応表を直すと表示が変わる", async ({ page }) => {
  const owner = await createUser("w8", E2E_OWNER_ID);
  await login(page, owner);

  // 前提: 作り物の CSV を API で取り込む
  const res = await page.request.post("/api/v1/import", {
    multipart: {
      file: { name: "kakebo.csv", mimeType: "text/csv", buffer: (await import("node:fs")).readFileSync(DUMMY) },
      mode: "commit",
      account_id: "new",
      schedule_keys: "[]",
    },
  });
  expect(res.status()).toBe(200);

  await page.goto("/budget?month=2026-09");
  await expect(page.getByRole("heading", { name: "予算" })).toBeVisible();
  for (const name of ["食費", "サブスク", "日用品", "移動", "先取り貯蓄", "自己投資", "自由費", "予備"]) {
    await expect(page.getByTestId(`frame-${name}`)).toBeVisible();
  }
  // 9月: 食費 1,000（パン×2）・サブスク 480（Spotify）・自由費 1,200（外食費）
  await expect(page.getByTestId("frame-食費")).toContainText("¥1,000");
  await expect(page.getByTestId("frame-サブスク")).toContainText("¥480");
  await expect(page.getByTestId("food-card")).toContainText("1日目安");
  await expect(page.getByTestId("trend-chart")).toBeVisible();

  // 対応表: 外食費を食費に → 食費が 2,200 になる
  await page.getByLabel("外食費 の費目").selectOption({ label: "食費" });
  await expect(page.getByTestId("frame-食費")).toContainText("¥2,200");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
