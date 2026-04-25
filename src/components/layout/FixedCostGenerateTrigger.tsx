/**
 * @file components/layout/FixedCostGenerateTrigger.tsx
 * @description 固定費の月次自動生成をトリガーする Client Component。
 *
 * 認証済みレイアウトにマウントされ、ページ遷移ではなくアプリ初回ロード時に
 * POST /api/v1/fixed-costs/generate を1回だけ呼び出す。
 *
 * sessionStorage にキー "fc_generated_YYYY_M" を保存することで、
 * 同一セッション内（ブラウザタブが開いている間）の重複呼び出しを防ぐ。
 * API 自体も冪等設計（同月分が既存なら何もしない）なので二重生成は起きない。
 */

"use client";

import { useEffect } from "react";

export function FixedCostGenerateTrigger() {
  useEffect(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    // セッション中にすでに生成済みかチェック
    const key = `fc_generated_${year}_${month}`;
    if (sessionStorage.getItem(key)) return;

    fetch("/api/v1/fixed-costs/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month }),
    })
      .then(() => {
        // 成功・スキップ問わず「今月は処理済み」としてマーク
        sessionStorage.setItem(key, "1");
      })
      .catch(() => {
        // エラーは握りつぶす（次回タブ開き直し時に再試行される）
      });
  }, []);

  // 表示は不要、副作用だけ担う
  return null;
}
