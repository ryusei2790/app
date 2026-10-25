/**
 * @file app/about/changes/page.tsx
 * @description 更新履歴とデータの持ち方（mywork#764 ⑥）。中身は lib/changes/history.ts。ログイン前でも読める。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { CHANGES, PRIVACY_NOTE } from "@/lib/changes/history";
import { DEFINITIONS_PATH } from "@/lib/aggregate/definitions";

export const metadata: Metadata = {
  title: "更新履歴 | カレンダー型家計簿",
  description: "いつ何が変わったかと、データの持ち方",
};

export default function ChangesPage() {
  return (
    <article className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">更新履歴</h1>
        <p className="mt-2 text-sm text-gray-600">新しい順です。</p>
      </header>

      <section id="privacy" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">データの持ち方</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-gray-800">
          {PRIVACY_NOTE.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-gray-600">
          どこに何が送られるかの一覧は、ログイン後の <Link href="/settings" className="text-blue-600 hover:underline">設定</Link> →「データの流れ」にあります。数字の数え方は <Link href={DEFINITIONS_PATH} className="text-blue-600 hover:underline">数字の定義</Link>。
        </p>
      </section>

      <ol className="space-y-4">
        {CHANGES.map((c) => (
          <li key={c.date + c.title} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">{c.date}</p>
            <h2 className="text-base font-semibold text-gray-900">{c.title}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-800">
              {c.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </article>
  );
}
