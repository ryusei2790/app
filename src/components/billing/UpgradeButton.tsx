/**
 * @file components/billing/UpgradeButton.tsx
 * @description 「有料プランにする」ボタン（mywork#970）。押すと Stripe の決済ページへ移る。
 */

"use client";

import Link from "next/link";
import { useState } from "react";

export function UpgradeButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message);
      window.location.href = json.data.url;
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "決済ページを開けませんでした");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        data-testid="upgrade-button"
        className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? "決済ページを開いています…" : "有料プランにする（月300円）"}
      </button>
      <p className="text-xs text-gray-500">
        レシート 1日20枚・月300枚、チャット無制限。いつでも解約できます。
        <Link href="/about/legal" className="ml-1 underline">特定商取引法の表記</Link>
      </p>
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}
