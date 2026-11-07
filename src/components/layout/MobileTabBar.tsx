/**
 * @file components/layout/MobileTabBar.tsx
 * @description スマホ幅（md 未満）の下のタブ（mywork#1238）。ホーム・手入力・レシート・決算・チャットの5つを常に出す。
 * 本人「ホームへの動線を増やして分かりやすくしたい」→ 上のメニューを開かなくても、親指の届く所から1回でホームに戻れるようにした。
 * 広い画面はサイドバーがあるので出さない。拡張機能（カレンダー・収支一覧など）は上の「メニュー」に残す。
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, tabItems, type NavMenu } from "@/lib/nav";

export function MobileTabBar({ menu }: { menu: NavMenu }) {
  const pathname = usePathname();
  const tabs = tabItems(menu.fixed);
  return (
    <nav
      aria-label="下のタブ"
      data-testid="tab-bar"
      // レイアウトの縦並び（flex-col）の最後の子。fixed にしないので本文に重ならない（本文は main の中だけで縦に流れる）
      className="md:hidden shrink-0 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const active = isActivePath(pathname, t.href);
          return (
            <li key={t.id}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  active ? "text-blue-700" : "text-gray-500 active:bg-gray-100"
                }`}
              >
                <span className="text-lg leading-none" aria-hidden>
                  {t.icon}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
