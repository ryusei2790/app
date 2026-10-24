/**
 * @file app/about/layout.tsx
 * @description ログイン前でも読めるページ（数字の定義など）の共通の枝。
 * ダッシュボードのメニューは出さず、上に戻り先だけ置く（proxy.ts の保護対象ではない）。
 */

import Link from "next/link";

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="text-base font-bold text-gray-900">
            カレンダー家計簿
          </Link>
          <div className="flex gap-4">
            <Link href="/about/help" className="text-sm text-blue-600 hover:underline">
              使い方
            </Link>
            <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
              ダッシュボードへ →
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
