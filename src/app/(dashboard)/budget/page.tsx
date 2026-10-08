/**
 * @file app/(dashboard)/budget/page.tsx
 * @description 予算台帳（社長専用）の画面（S6）。
 * 社長（OWNER_USER_IDS）以外には 404 を返し、画面があること自体を見せない。
 * 中身は 9/22 の予算台帳計画の順で後から作る。
 */

import { notFound } from "next/navigation";
import { getAuthUser } from "@/lib/api-helpers";
import { isOwner } from "@/lib/features";

export default async function BudgetPage() {
  const user = await getAuthUser();
  if (!isOwner(user)) notFound();

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900">予算台帳</h1>
      <p className="mt-2 text-sm text-gray-500">準備中です（社長アカウントだけに表示されています）。</p>
    </div>
  );
}
