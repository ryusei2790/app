/**
 * @file components/layout/ErrorScreen.tsx
 * @description 画面ごと表示できなかったときの中身（error.tsx・global-error.tsx・not-found.tsx で共用、mywork#764 ③）。
 * 何が起きたか・データは消えていないこと・次の一手（もう一度／ホーム）を日本語で出す。
 */

"use client";

import Link from "next/link";

export function ErrorScreen({
  title,
  message,
  onRetry,
  digest,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  /** サーバーの記録と照らし合わせる番号（Vercel のログ検索用） */
  digest?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-6 text-center" role="alert">
      <h1 className="text-lg font-bold text-gray-900">{title}</h1>
      <p className="text-sm text-gray-700">{message}</p>
      <div className="flex flex-col gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white"
          >
            もう一度
          </button>
        )}
        {/* global-error ではルーターが壊れている場合があるので a で開き直す */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-800">
          ホームへ戻る
        </a>
        <Link href="/about/help" className="text-xs text-gray-500 underline">
          使い方を見る
        </Link>
      </div>
      {digest && <p className="text-xs text-gray-400">エラー番号: {digest}</p>}
    </div>
  );
}
