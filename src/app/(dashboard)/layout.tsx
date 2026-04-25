/**
 * @file app/(dashboard)/layout.tsx
 * @description 認証必須ページ群の共通レイアウト。
 * サーバーサイドで認証チェックを行い、未認証なら /login にリダイレクト。
 * サイドバーはアクティブリンクをハイライト表示する。
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { FixedCostGenerateTrigger } from "@/components/layout/FixedCostGenerateTrigger";

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
    <div className="flex h-screen bg-gray-50">
      <Sidebar userEmail={user.email ?? ""} />
      <main className="flex-1 overflow-y-auto">{children}</main>
      {/* 固定費の月次自動生成：ログイン後の初回ロードで当月分を生成する */}
      <FixedCostGenerateTrigger />
    </div>
  );
}
