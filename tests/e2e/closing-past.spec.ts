/**
 * @file tests/e2e/closing-past.spec.ts
 * @description さかのぼって決算・決算から目標（mywork#1238 第2弾）。スマホ幅（375px）。
 * 加入したばかりの人が「先月の決算をして今月の目標を立てる」流れを通す。AI は E2E では呼ばない（鍵なし＝提案は作らない）。
 *   P1 決算する月で先月を選べる（記録あり）。記録が無い月は「記録なし」
 *   P2 先月の支出から今月の目標の候補が出て、選ぶと保存される
 *   P3 今月の決算の画面に「この月の目標 ／ 使った」が出る
 *   P4 手で金額を入れて決め直せる・消せる
 */

import { expect, test } from "@playwright/test";
import { createAccount, createUser, login, todayJst } from "./helpers";

function prevMonth(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`;
}

test("P1〜P4 先月を後から決算して、今月の目標を決める", async ({ page }) => {
  const user = await createUser("closing-past");
  await login(page, user);
  const account = await createAccount(page);
  const cur = todayJst().slice(0, 7);
  const last = prevMonth(cur);
  for (const [date, amount] of [[`${last}-05`, 80000], [`${last}-20`, 43456]] as const) {
    const r = await page.request.post("/api/v1/transactions", { data: { account_id: account, amount, type: "expense", transaction_date: date, note: "e2e" } });
    expect(r.status()).toBe(201);
  }

  // P1 決算する月
  await page.goto("/closing");
  const sel = page.getByTestId("closing-month");
  await expect(sel.locator("option")).toHaveCount(12);
  await expect(sel.locator(`option[value="${last}"]`)).toHaveText(/（先月）/);
  await expect(sel.locator(`option[value="${prevMonth(last)}"]`)).toHaveText(/記録なし/);
  await sel.selectOption(last);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(new RegExp(`${Number(last.slice(5))}月の決算`));

  // P2 今月の目標の候補（先月の支出 123,456 円 → 123,000 / 117,000 / 111,000）
  const goal = page.getByTestId("closing-goal");
  await expect(goal.getByRole("heading")).toHaveText(/この結果から今月の目標を決める/);
  await goal.getByRole("button", { name: /5%減らす/ }).click();
  await expect(goal.getByText(/の目標を ¥117,000 にしました/)).toBeVisible();
  await expect(goal.getByTestId("closing-goal-current")).toHaveText(/¥117,000/);

  // P3 今月の画面に目標と使った額
  await sel.selectOption(cur);
  await expect(page.getByTestId("closing-goal-progress")).toHaveText(/この月の目標 ¥117,000 ／ 使った ¥0（あと ¥117,000）/);

  // P4 決め直し・消す
  await sel.selectOption(last);
  await goal.getByRole("textbox").fill("100000");
  await goal.getByRole("button", { name: "この額にする" }).click();
  await expect(goal.getByTestId("closing-goal-current")).toHaveText(/¥100,000/);
  await goal.getByRole("button", { name: "目標を消す" }).click();
  await expect(goal.getByText("目標を消しました")).toBeVisible();
  await sel.selectOption(cur);
  await expect(page.getByTestId("closing-goal-progress")).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
