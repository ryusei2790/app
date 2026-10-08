/**
 * @file tests/e2e/pwa.spec.ts
 * @description テスト一覧 F の W1（インストールできる）・W2（オフライン）。
 */

import { expect, test } from "@playwright/test";
import { createAccount, createUser, login } from "./helpers";

test("W1 manifest が読め、アイコンが取れ、ページから参照されている", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m).toMatchObject({ start_url: "/calendar", display: "standalone" });
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test("W2 Service Worker が登録され、オフラインでは「接続が必要」を出し、取引を保存しない", async ({ page, context }) => {
  const user = await createUser("w2");
  await login(page, user);
  await createAccount(page);

  // 1. Service Worker が動いている
  await page.goto("/calendar");
  const active = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(reg.active);
  });
  expect(active).toBe(true);
  await page.reload(); // SW が画面を受け持つ状態にする

  // 2. 取引の入力中にネットが切れる → 帯で知らせる
  await page.locator('button[aria-current="date"]').click();
  await page.getByRole("button", { name: "+ 収支を追加" }).click();
  await page.getByLabel("金額（円）").fill("4321");
  await page.getByLabel("口座 *").selectOption({ label: "財布" });
  await context.setOffline(true);
  // 入力欄はモーダルの中なので、外側の帯は読み上げ上は隠れる（aria-hidden）。文字で探す
  await expect(page.getByText("接続が必要です。オフラインの間は記録できません。")).toBeVisible();

  // 3. そのまま保存を押しても保存されない（失敗と表示。あとで送る仕組みも無い）
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存に失敗しました")).toBeVisible();

  // 4. オフラインのまま別の画面へ移ると、Service Worker が「接続が必要」の画面を返す
  await page.goto("/transactions").catch(() => undefined);
  await expect(page.getByText("接続が必要です")).toBeVisible();

  // 5. オンラインに戻っても、さっきの取引は入っていない
  await context.setOffline(false);
  const res = await page.request.get(`/api/v1/transactions?year=2026&month=${new Date().getMonth() + 1}`);
  const { data } = await res.json();
  expect(data.filter((t: { amount: number }) => t.amount === 4321)).toHaveLength(0);
});
