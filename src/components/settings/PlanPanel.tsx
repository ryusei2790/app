/**
 * @file components/settings/PlanPanel.tsx
 * @description 設定の「プラン」タブ（mywork#970）。いまのプランと、申し込み・解約の入口を出す。
 */

"use client";

import { useEffect, useState } from "react";
import { UpgradeButton } from "@/components/billing/UpgradeButton";

interface Usage {
  unlimited: boolean;
  paid: boolean;
  canUpgrade: boolean;
  canManage: boolean;
}

export function PlanPanel() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/usage")
      .then((r) => r.json())
      .then((j) => setUsage(j.data))
      .catch(() => setError("プランを読み込めませんでした"));
  }, []);

  async function openPortal() {
    setError(null);
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const json = await res.json().catch(() => null);
    if (res.ok) window.location.href = json.data.url;
    else setError(json?.error?.message ?? "解約の画面を開けませんでした");
  }

  if (error) return <p className="text-sm text-red-600" role="alert">{error}</p>;
  if (!usage) return <p className="text-sm text-gray-500">読み込み中…</p>;

  return (
    <div className="space-y-4 rounded-xl bg-white p-4 text-sm text-gray-800">
      <p data-testid="plan-name" className="font-semibold">
        {usage.unlimited ? "本人アカウント（回数の上限なし）" : usage.paid ? "有料プラン（月300円）" : "無料プラン"}
      </p>
      <p className="text-xs text-gray-500">
        {usage.paid
          ? "レシート 1日20枚・月300枚、チャット無制限。"
          : "レシート 1日5枚・月30枚、チャット 1日30回。決済の直後は反映に数秒かかります。"}
      </p>
      {!usage.unlimited && !usage.paid && !usage.canUpgrade && usage.canManage && (
        <p className="text-xs text-amber-700">お支払いを確認できていません。下からカードを更新してください。</p>
      )}
      {usage.canUpgrade && <UpgradeButton />}
      {usage.canManage && (
        <button type="button" onClick={openPortal} className="text-sm text-blue-600 underline">
          解約・カードの変更
        </button>
      )}
    </div>
  );
}
