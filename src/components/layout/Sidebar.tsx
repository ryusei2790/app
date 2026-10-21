/**
 * @file components/layout/Sidebar.tsx
 * @description サイドバーナビゲーション（Client Component）。
 * 中身は NavList（固定の5つ＋マイメニュー、mywork#573）。
 * ログアウトボタンも配置する。
 */

"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { NavMenu } from "@/lib/nav";
import { NavList } from "./NavList";

interface SidebarProps {
  userEmail: string;
  /** 固定の5つ＋マイメニュー（サーバー側の layout で本人の分を作って渡す。社長専用は社長にだけ入る） */
  menu: NavMenu;
}

export function Sidebar({ userEmail, menu }: SidebarProps) {
  const router = useRouter();

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="hidden w-60 shrink-0 border-r border-gray-200 bg-white md:flex md:flex-col">
      {/* ロゴ */}
      <div className="px-4 py-5 border-b border-gray-100">
        <h1 className="text-base font-bold text-gray-900">カレンダー家計簿</h1>
        <p className="mt-0.5 text-xs text-gray-400 truncate">{userEmail}</p>
      </div>

      {/* ナビゲーション */}
      <nav className="flex-1 p-3 overflow-y-auto">
        <NavList menu={menu} />
      </nav>

      {/* ログアウト */}
      <div className="p-3 border-t border-gray-100">
        <button
          onClick={handleLogout}
          className="w-full rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 text-left transition-colors"
        >
          ログアウト
        </button>
      </div>
    </aside>
  );
}
