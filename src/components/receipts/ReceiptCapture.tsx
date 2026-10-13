/**
 * @file components/receipts/ReceiptCapture.tsx
 * @description レシートを撮る（選ぶ）→ ブラウザで縮小 → 読み取り API に送る（設計書 B1〜B3、テスト一覧 W4）。
 *
 * - `<input type="file" accept="image/*" capture="environment">` で iPhone・Android とも背面カメラが開く
 * - 送る前に長辺1,568px・JPEG に縮小（lib/image/compress.ts。位置情報などの EXIF も落ちる）
 * - 初回だけ「写真の送り先・保存しないこと」を見せて同意を取る（この端末に同意済みの印を残す）
 * - 読み取り中は「やめる」で取り消せる（取り消しは回数に数えない）
 * - 残り回数が0・全体の上限・AI の失敗のときは、理由と「手入力する」を出す
 */

"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { compressImage } from "@/lib/image/compress";
import type { ReceiptDraft } from "@/lib/receipt/schema";

const CONSENT_KEY = "receipt_consent_v1";

function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export interface ParseResult {
  draft: ReceiptDraft;
  model: string;
}

interface Props {
  usage: { day: { remaining: number }; month: { remaining: number }; available: boolean } | null;
  onParsed: (result: ParseResult) => void;
}

export function ReceiptCapture({ usage, onParsed }: Props) {
  // 同意済みの印は localStorage にある。サーバーで描くときは「未同意」として描き、ブラウザで読み直す（表示のずれを防ぐ）
  const stored = useSyncExternalStore(() => () => undefined, hasConsent, () => false);
  const [justAgreed, setJustAgreed] = useState(false);
  const consented = stored || justAgreed;
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function giveConsent() {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      // 保存できない環境（プライベートブラウズ等）では、この画面を開いている間だけ同意扱い
    }
    setJustAgreed(true);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // 1. 縮小（失敗したら元のまま送らず止める。大きい写真をそのまま送らないため）
      const small = await compressImage(file);
      // 2. 送る
      const form = new FormData();
      form.set("image", small, "receipt.jpg");
      const res = await fetch("/api/v1/receipts/parse", { method: "POST", body: form, signal: ac.signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "読み取りに失敗しました");
      onParsed({ draft: json.data.draft, model: json.data.model });
    } catch (e) {
      if (ac.signal.aborted) setError("読み取りをやめました（回数は減っていません）。");
      else setError(e instanceof Error ? e.message : "読み取りに失敗しました");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  if (!consented) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 text-sm text-gray-800">
        <p className="font-semibold">レシート読み取りについて</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>写真は読み取りのため AI の事業者（OpenRouter 経由で Google など、日本国外）に送られます。</li>
          <li>写真はこのアプリにも事業者にも保存されません。読み取った文字だけを、あなたが保存を押したときに記録します。</li>
          <li>1日5枚・月30枚まで使えます。</li>
        </ul>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          上の内容に同意します
        </label>
        <button
          type="button"
          disabled={!agree}
          onClick={giveConsent}
          className="w-full rounded-lg bg-blue-600 py-2 font-medium text-white disabled:opacity-40"
        >
          同意して始める
        </button>
      </div>
    );
  }

  const exhausted = usage !== null && !usage.available;

  return (
    <div className="space-y-4">
      {usage && (
        <p className="text-xs text-gray-500" data-testid="receipt-remaining">
          今日あと {usage.day.remaining} 枚 ／ 今月あと {usage.month.remaining} 枚
        </p>
      )}

      {exhausted ? (
        <div className="rounded-xl bg-gray-100 p-4 text-sm text-gray-700">
          いまはレシート読み取りを使えません（上限に達しました）。
          <Link href="/calendar" className="ml-1 text-blue-600 underline">手入力する</Link>
        </div>
      ) : busy ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 text-center space-y-3" role="status">
          <p className="text-sm text-blue-800">読み取り中…（10秒ほど）</p>
          <button type="button" onClick={() => abortRef.current?.abort()} className="text-sm text-gray-600 underline">
            やめる
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center hover:border-blue-400">
          <span className="text-3xl" aria-hidden>📷</span>
          <span className="text-sm font-medium text-gray-800">レシートを撮る・選ぶ</span>
          <span className="text-xs text-gray-500">明るい所で、レシート全体が入るように</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="レシートの写真"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
          <Link href="/calendar" className="ml-1 underline">手入力する</Link>
        </div>
      )}
    </div>
  );
}
