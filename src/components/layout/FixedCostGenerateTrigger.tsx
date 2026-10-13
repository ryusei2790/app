/**
 * @file components/layout/FixedCostGenerateTrigger.tsx
 * @description 画面を開いたときに、本人の定期支出・定期収入を今日まで展開させる Client Component。
 *
 * 認証済みレイアウトにマウントされ、POST /api/v1/fixed-costs/generate を1日1回だけ呼ぶ。
 * 毎日の定期実行（api/cron/fixed-costs）が本命で、これは「今日の分をすぐ見たい」ときの補助。
 * sessionStorage のキー "fc_generated_YYYY-MM-DD" で同じタブ内の重複呼び出しを防ぐ。
 * API 自体も冪等（展開済みの印より後しか作らない）なので、二重に呼んでも二重には作られない。
 */

"use client";

import { useEffect } from "react";

export function FixedCostGenerateTrigger() {
  useEffect(() => {
    const n = new Date();
    const key = `fc_generated_${n.getFullYear()}-${n.getMonth() + 1}-${n.getDate()}`;
    if (sessionStorage.getItem(key)) return;

    fetch("/api/v1/fixed-costs/generate", { method: "POST" })
      .then((res) => {
        if (res.ok) sessionStorage.setItem(key, "1");
      })
      .catch(() => {
        // エラーは握りつぶす（次に開いたとき・毎日の定期実行で作られる）
      });
  }, []);

  // 表示は不要、副作用だけ担う
  return null;
}
