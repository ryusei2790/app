/**
 * @file app/about/help/page.tsx
 * @description 使い方のページ（mywork#764 ①）。最初の設定 → CSV 取り込み → 要確認 → 定期・サブスク → 書き出しの順。
 * 中身は lib/help/sections.ts。ログイン前でも読める（家計の数字は何も無い）。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { HELP_SECTIONS } from "@/lib/help/sections";
import { DEFINITIONS_PATH } from "@/lib/aggregate/definitions";

export const metadata: Metadata = {
  title: "使い方 | カレンダー型家計簿",
  description: "最初の設定から CSV の取り込み・要確認・定期とサブスク・書き出しまでの使い方",
};

export default function HelpPage() {
  return (
    <article className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">使い方</h1>
        <p className="mt-2 text-sm text-gray-600">上から順にやれば使い始められます。各画面の「？」からもここに来られます。</p>
        <nav className="mt-3 flex flex-wrap gap-2 text-sm">
          {HELP_SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-blue-600 hover:bg-gray-50">
              {s.title}
            </a>
          ))}
        </nav>
      </header>

      {HELP_SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">{s.title}</h2>
            {s.href && (
              <Link href={s.href} className="text-sm text-blue-600 hover:underline">
                画面を開く →
              </Link>
            )}
          </div>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-gray-800">
            {s.steps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          {s.tips && (
            <ul className="mt-3 space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              {s.tips.map((t) => (
                <li key={t}>💡 {t}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <p className="text-sm text-gray-600">
        数字の数え方は <Link href={DEFINITIONS_PATH} className="text-blue-600 hover:underline">数字の定義</Link> にあります。
      </p>
    </article>
  );
}
