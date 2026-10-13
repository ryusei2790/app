/**
 * @file app/(dashboard)/budget/page.tsx
 * @description 予算台帳（社長専用）の画面（S6・W8）。
 * 社長（OWNER_USER_IDS）以外には 404 を返し、画面があること自体を見せない。
 * 中身（費目別の実績・食費の1日目安・推移・対応表）は BudgetView が /api/v1/budget から読む。
 * ?month=YYYY-MM で開く月を指定できる（推移の棒を押したときや、経理部が月を指定して見るとき）。
 */

import { notFound } from "next/navigation";
import { getAuthUser } from "@/lib/api-helpers";
import { isOwner } from "@/lib/features";
import { BudgetView } from "@/components/budget/BudgetView";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function BudgetPage(props?: { searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const user = await getAuthUser();
  if (!isOwner(user)) notFound();

  const raw = (await props?.searchParams)?.month;
  const month = typeof raw === "string" && MONTH_RE.test(raw) ? raw : undefined;
  return <BudgetView initialMonth={month} />;
}
