/**
 * @file components/layout/NavList.tsx
 * @description メニューの中身（固定の5つ＋マイメニュー）。Sidebar と MobileNav で同じものを出す（mywork#573）。
 * 固定の5つは全員同じ並びで、マイメニューは本人がチャットで選んだ機能だけ。空ならチャットへの案内を出す。
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, type NavItem, type NavMenu } from "@/lib/nav";

function Item({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.href);
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        }`}
      >
        <span className="text-base">{item.icon}</span>
        {item.label}
      </Link>
    </li>
  );
}

export function NavList({ menu, onNavigate }: { menu: NavMenu; onNavigate?: () => void }) {
  return (
    <>
      <ul className="space-y-0.5">
        {menu.fixed.map((item) => (
          <Item key={item.id} item={item} onNavigate={onNavigate} />
        ))}
      </ul>
      <p className="mt-4 px-3 pb-1 text-xs font-semibold text-gray-400">マイメニュー</p>
      {menu.mine.length > 0 ? (
        <ul className="space-y-0.5" data-testid="my-menu">
          {menu.mine.map((item) => (
            <Item key={item.id} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : (
        <p className="px-3 py-1 text-xs text-gray-400">💬 チャットで「〇〇ある？」と聞くと、ここに機能を追加できます</p>
      )}
    </>
  );
}
