/**
 * @file components/receipts/ReceiptFlow.tsx
 * @description レシート画面の流れ（撮る → 確認・修正 → 保存）をまとめる（テスト一覧 W4）。
 * 残り回数（GET /api/v1/usage）を最初と保存のたびに読み直す。
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ReceiptCapture, type ParseResult } from "./ReceiptCapture";
import { ReceiptReview } from "./ReceiptReview";

type Usage = { day: { remaining: number }; month: { remaining: number }; available: boolean };

export function ReceiptFlow() {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && j && setUsage(j.data))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [reload]);

  const restart = () => {
    setParsed(null);
    setSaved(false);
    setReload((n) => n + 1);
  };

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6 space-y-4">
      <h2 className="text-xl font-bold text-gray-900">レシートで登録</h2>

      {saved ? (
        <div className="rounded-xl bg-green-50 p-4 text-sm text-green-800 space-y-3" role="status">
          <p>保存しました。</p>
          <div className="flex gap-2">
            <button type="button" onClick={restart} className="flex-1 rounded-lg border border-green-300 py-2">続けて読む</button>
            <Link href="/transactions" className="flex-1 rounded-lg bg-green-600 py-2 text-center font-medium text-white">収支一覧へ</Link>
          </div>
        </div>
      ) : parsed ? (
        <ReceiptReview draft={parsed.draft} model={parsed.model} onSaved={() => setSaved(true)} onRetake={restart} />
      ) : (
        <ReceiptCapture
          usage={usage}
          onParsed={(r) => {
            setParsed(r);
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
