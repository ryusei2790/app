/**
 * @file components/layout/Sidebar.tsx
 * @description サイドバーナビゲーション（Client Component）。
 * usePathname() でアクティブなリンクをハイライトする。
 * ログアウトボタンも配置する。
 */

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { navItemsFor } from "@/lib/nav";

interface SidebarProps {
  userEmail: string;
  /** 社長アカウントか（サーバー側の layout で判定して渡す。予算台帳のメニューを出すかどうか） */
  isOwner?: boolean;
}

export function Sidebar({ userEmail, isOwner = false }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-60 shrink-0 border-r border-gray-200 bg-white flex flex-col">
      {/* ロゴ */}
      <div className="px-4 py-5 border-b border-gray-100">
        <h1 className="text-base font-bold text-gray-900">カレンダー家計簿</h1>
        <p className="mt-0.5 text-xs text-gray-400 truncate">{userEmail}</p>
      </div>

      {/* ナビゲーション */}
      <nav className="flex-1 p-3 overflow-y-auto">
        <ul className="space-y-0.5">
          {navItemsFor({ isOwner }).map(({ href, label, icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  <span className="text-base">{icon}</span>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
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
