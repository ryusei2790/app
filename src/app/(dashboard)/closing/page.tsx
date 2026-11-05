/**
 * @file app/(dashboard)/closing/page.tsx
 * @description 標準機能③「今月の決算」（mywork#1150）。第1弾は場所だけ。提案ボット（Markdown→HTML）は第2弾で入る。
 */

import Link from "next/link";

export default function ClosingPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <h2 className="text-xl font-bold text-gray-900">🧾 今月の決算</h2>
      <div className="rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm" data-testid="closing-soon">
        <p>決算日に、今月の目標の達成ぐあいと、次の月の目標・配分・気をつける点・使いすぎ注意をまとめて提案します。</p>
        <p className="mt-2 text-gray-500">準備中です（次の更新で使えるようになります）。</p>
      </div>
      <Link href="/start" className="block text-center text-sm text-blue-600 hover:underline">ホームへ戻る</Link>
    </div>
  );
}
