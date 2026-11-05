/**
 * @file app/(dashboard)/start/page.tsx
 * @description ホーム（mywork#1150 Q2 A）。標準3つ（手入力・レシート・今月の決算）を大きいボタンで出し、
 * その下に本人が足した拡張機能を並べる。ログイン後とアプリの起動はここに来る。
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/api-helpers";
import { STANDARD_FEATURES } from "@/lib/menu/catalog";
import { menuForUser } from "@/lib/menu/menu-for-user";

export default async function StartPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const { mine } = await menuForUser(user);
  return (
    <div className="mx-auto max-w-xl space-y-6 p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-3" data-testid="standard-features">
        {STANDARD_FEATURES.map((f, i) => (
          <Link
            key={f.id}
            href={f.href}
            className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white p-6 text-base font-bold text-gray-900 shadow-sm hover:bg-blue-50 ${
              i === STANDARD_FEATURES.length - 1 && STANDARD_FEATURES.length % 2 === 1 ? "col-span-2" : ""
            }`}
          >
            <span className="text-3xl">{f.icon}</span>
            {f.label}
          </Link>
        ))}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-500">拡張機能</h2>
        {mine.length > 0 && (
          <ul className="grid grid-cols-3 gap-2" data-testid="start-extensions">
            {mine.map((m) => (
              <li key={m.id}>
                <Link href={m.href} className="flex flex-col items-center gap-1 rounded-xl bg-white p-3 text-xs text-gray-700 shadow-sm hover:bg-gray-100">
                  <span className="text-xl">{m.icon}</span>
                  {m.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/extensions" className="mt-3 block rounded-xl border border-dashed border-gray-300 p-3 text-center text-sm text-blue-600 hover:bg-blue-50">
          ＋ 拡張機能を追加
        </Link>
      </section>

      <Link
        href="/chat"
        aria-label="チャット（機能の相談・追加・要望）"
        className="fixed bottom-5 right-5 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-2xl text-white shadow-lg hover:bg-blue-700"
      >
        💬
      </Link>
    </div>
  );
}
