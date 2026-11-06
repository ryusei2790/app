/**
 * @file tests/e2e/survey.spec.ts
 * @description 月1回のアンケート（mywork#1150 第3弾）をスマホ幅で通し操作する。
 * 決算画面 → アンケート → Q1 を声（音声認識はページに差し込んだ偽物）→ OK → Q2〜Q5 を文字 → 完了 → ホームのお知らせが消える。
 * AI のキーは E2E に無いので、整形は「文字をそのまま返す」予備の動きになる（AI の中身は unit・api テストで確かめる）。
 */

import { expect, test } from "@playwright/test";
import { createUser } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("アンケート5問を声と文字で答えて完了する", async ({ page }) => {
  // 偽の音声認識（Chromium は本物の SpeechRecognition を持つので両方の名前を差し替える）: start すると少し後に確定の文字を1つ返し、stop で終わる
  await page.addInitScript(`
    window.SpeechRecognition = window.webkitSpeechRecognition = function FakeRec() {
      var self = this;
      self.onresult = null; self.onerror = null; self.onend = null;
      self.start = function () {
        setTimeout(function () {
          var r = [{ transcript: "えーと8点です。レシートが便利でした" }];
          r.isFinal = true;
          if (self.onresult) self.onresult({ resultIndex: 0, results: [r] });
        }, 100);
      };
      self.stop = function () { setTimeout(function () { if (self.onend) self.onend(); }, 50); };
    };
  `);

  const u = await createUser("survey");
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(u.email);
  await page.getByLabel("パスワード").fill(u.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto("/closing");
  await page.getByTestId("closing-survey-link").click();
  await page.waitForURL("**/survey");
  await expect(page.getByTestId("survey-consent")).toContainText("音声は保存しません");
  await page.screenshot({ path: "docs/screenshots/1150-phase3/01_Q1.png", fullPage: true });

  // Q1 声で
  await page.getByTestId("survey-mic").click();
  await expect(page.getByText("えーと8点です")).toBeVisible();
  await page.getByTestId("survey-mic").click(); // 話し終わった
  await expect(page.getByTestId("survey-draft")).toBeVisible();
  await expect(page.getByTestId("survey-score")).toHaveValue("8");
  await page.screenshot({ path: "docs/screenshots/1150-phase3/02_Q1_聞き取り確認.png", fullPage: true });
  await page.getByTestId("survey-ok").click();

  // Q2〜Q5 文字で
  for (let i = 2; i <= 5; i++) {
    await expect(page.getByTestId("survey-question")).toContainText(`Q${i} / 5`);
    await page.getByRole("button", { name: "⌨️ 文字で答える" }).click();
    await page.getByTestId("survey-text").fill(`Q${i} の回答です`);
    if (i === 2) await page.screenshot({ path: "docs/screenshots/1150-phase3/03_Q2_文字入力.png", fullPage: true });
    await page.getByTestId("survey-text-submit").click();
    await expect(page.getByTestId("survey-draft")).toBeVisible();
    await page.getByTestId("survey-ok").click();
  }

  await expect(page.getByTestId("survey-done")).toBeVisible();
  await expect(page.getByTestId("survey-done")).toContainText("8点");
  await page.screenshot({ path: "docs/screenshots/1150-phase3/04_完了.png", fullPage: true });

  await page.goto("/start");
  await expect(page.getByTestId("survey-notice")).toHaveCount(0);
});
