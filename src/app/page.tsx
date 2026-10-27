/**
 * @file app/page.tsx
 * @description トップページ。ログイン済みなら /calendar へ、未ログインなら広告の着地ページ（mywork#878）を出す。
 * proxy.ts の保護対象に / は入っていないので、未ログインでもここまで来る（UTM のクエリも落ちない）。
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/api-helpers";
import { LandingPage } from "@/components/lp/LandingPage";

export const metadata: Metadata = {
  title: "カレンダー家計簿 — 打ち込まない家計簿",
  description: "クレカ明細を入れるだけで、1か月の支出・サブスク・固定費がカレンダーで見える家計簿。公開のお知らせを受付中。",
  openGraph: {
    title: "カレンダー家計簿 — 打ち込まない家計簿",
    description: "クレカ明細を入れるだけで、1か月の支出がカレンダーで見える。",
    type: "website",
    locale: "ja_JP",
  },
};

export default async function Home() {
  if (await getAuthUser()) redirect("/calendar");
  return <LandingPage />;
}
