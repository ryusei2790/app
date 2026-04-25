/**
 * @file app/page.tsx
 * @description トップページ。
 * ミドルウェアが認証状態に応じて /login または /calendar にリダイレクトするため、
 * このページが直接表示されることはほぼない。
 */

import { redirect } from "next/navigation";

export default function Home() {
  // ミドルウェアでリダイレクトされるが、念のため明示的にも行う
  redirect("/calendar");
}
