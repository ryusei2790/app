/**
 * @file components/layout/MobileNav.tsx
 * @description スマホ幅（md 未満）用の上部バー＋メニュー（テスト一覧 W3・W6）。
 * 広い画面では Sidebar を出し、狭い画面ではこちらを出す（サイドバーが 375px の半分以上を取っていたため）。
 * メニューの項目は Sidebar と同じ NavList（固定の5つ＋マイメニュー。社長専用の項目は社長にだけ）。
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { NavMenu } from "@/lib/nav";
import { NavList } from "./NavList";

export function MobileNav({ userEmail, menu }: { userEmail: string; menu: NavMenu }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="md:hidden border-b border-gray-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-base font-bold text-gray-900">カレンダー家計簿</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700"
        >
          メニュー
        </button>
      </div>
      {open && (
        <nav id="mobile-menu" className="border-t border-gray-100 px-2 pb-3">
          <p className="px-3 py-2 text-xs text-gray-400 truncate">{userEmail}</p>
          <NavList menu={menu} onNavigate={() => setOpen(false)} />
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-500"
          >
            ログアウト
          </button>
        </nav>
      )}
    </header>
  );
}
