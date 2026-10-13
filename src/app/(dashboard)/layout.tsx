/**
 * @file app/(dashboard)/layout.tsx
 * @description 認証必須ページ群の共通レイアウト。
 * サーバーサイドで認証チェックを行い、未認証なら /login にリダイレクト。
 * サイドバーはアクティブリンクをハイライト表示する。
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { OfflineNotice } from "@/components/pwa/OfflineNotice";
import { FixedCostGenerateTrigger } from "@/components/layout/FixedCostGenerateTrigger";
import { isOwner } from "@/lib/features";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ミドルウェアでもチェックしているが、多重防御として Server Component でも確認
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 md:flex-row">
      {/* 広い画面はサイドバー、スマホ幅は上部バー＋メニュー */}
      <Sidebar userEmail={user.email ?? ""} isOwner={isOwner(user)} />
      <MobileNav userEmail={user.email ?? ""} isOwner={isOwner(user)} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <OfflineNotice />
        {children}
      </main>
      {/* 定期支出の展開：画面を開いたとき今日までの分を作る（本命は毎日の定期実行） */}
      <FixedCostGenerateTrigger />
    </div>
  );
}
