/**
 * @file app/(dashboard)/review/page.tsx
 * @description 要確認の画面（Server Component）。ReviewView（Client Component）を返す薄いラッパー。
 * ?month=YYYY-MM でダッシュボードから月を引き継ぐ。
 */

import { ReviewView } from "@/components/review/ReviewView";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  const initialMonth = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined;
  return <ReviewView initialMonth={initialMonth} />;
}
