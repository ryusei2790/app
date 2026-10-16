/**
 * @file tests/e2e/data-export.spec.ts
 * @description テスト一覧 W10（mywork#425 第2弾）。スマホ幅（375px）で
 *   設定 → データと書き出し → CSV が落ちる → 全削除は完全形式を落とすまで押せない → 確認語 → 空になる → 落とした完全形式で元に戻る
 * と、取り込みの取り消し（履歴から「取り消す」→「取り消し済み」）を通す。データは作り物だけ（ローカルの Supabase）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createAccount, createUser, login } from "./helpers";

const DUMMY = path.resolve(__dirname, "../fixtures/csv/kakebo_dummy.csv");

async function addTx(page: Page, accountId: string, note: string) {
  const res = await page.request.post("/api/v1/transactions", {
    data: { account_id: accountId, amount: 1200, type: "expense", transaction_date: "2026-09-03", note },
  });
  expect(res.status()).toBe(201);
}

async function txCount(page: Page) {
  const json = await (await page.request.get("/api/v1/transactions?year=2026&month=9")).json();
  return (json.data as unknown[]).length;
}

async function openDataTab(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "データと書き出し" }).click();
}

test("W10 書き出し → 全削除は完全形式を落とすまで押せない → 確認語 → 空になる → 復元で戻る", async ({ page }) => {
  const user = await createUser("w10");
  await login(page, user);
  const account = await createAccount(page);
  await addTx(page, account, "W10 のランチ");
  await openDataTab(page);

  // 1. 家計簿アプリ形式 CSV が落ちる
  const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /CSV（家計簿アプリ形式）/ }).click()]);
  expect(csvDl.suggestedFilename()).toMatch(/^kakebo_\d{4}-\d{2}-\d{2}\.csv$/);

  // 2. 全削除: 完全形式を落とすまで、確認語の欄も削除ボタンも押せない
  const confirmInput = page.getByLabel("確認のため「削除」と入力");
  const deleteButton = page.getByRole("button", { name: "全部削除する" });
  await expect(confirmInput).toBeDisabled();
  await expect(deleteButton).toBeDisabled();

  const [backupDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /バックアップを保存して次へ/ }).click()]);
  expect(backupDl.suggestedFilename()).toMatch(/^kakebo-full_\d{4}-\d{2}-\d{2}\.json$/);
  const backupPath = test.info().outputPath("backup.json");
  await backupDl.saveAs(backupPath);
  expect(JSON.parse(readFileSync(backupPath, "utf8")).counts.transactions).toBe(1);

  // 3. 確認語が違えば押せない → 「削除」で押せる → 空になる
  await expect(confirmInput).toBeEnabled();
  await confirmInput.fill("さくじょ");
  await expect(deleteButton).toBeDisabled();
  await confirmInput.fill("削除");
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page.getByTestId("delete-all-result")).toContainText("削除しました");
  expect(await txCount(page)).toBe(0);

  // 4. 落とした完全形式で元に戻る（空の帳簿だけ）
  await page.getByLabel("完全形式のファイルを選ぶ").setInputFiles(backupPath);
  await expect(page.getByTestId("restore-preview")).toContainText("取引 1件");
  await page.getByRole("button", { name: "復元する" }).click();
  await expect(page.getByTestId("restore-result")).toContainText("復元しました");
  expect(await txCount(page)).toBe(1);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("W10 取り込みの取り消し: 履歴の「取り消す」→ 確かめる → その取り込みの取引が消えて「取り消し済み」", async ({ page }) => {
  const user = await createUser("w10-undo");
  await login(page, user);
  const res = await page.request.post("/api/v1/import", {
    multipart: {
      file: { name: "kakebo.csv", mimeType: "text/csv", buffer: readFileSync(DUMMY) },
      mode: "commit",
      account_id: "new",
      schedule_keys: "[]",
    },
  });
  expect(res.status()).toBe(200);
  expect(await txCount(page)).toBeGreaterThan(0);

  await openDataTab(page);
  const item = page.getByTestId("import-history").getByRole("listitem").filter({ hasText: "kakebo.csv" });
  await item.getByRole("button", { name: "取り消す" }).click();
  await item.getByRole("button", { name: /取り消してよい/ }).click();
  await expect(item).toContainText("取り消し済み");
  expect(await txCount(page)).toBe(0);
});
