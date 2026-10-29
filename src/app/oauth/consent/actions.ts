/**
 * @file oauth/consent/actions.ts
 * @description AI 接続の同意画面の「許可する」「許可しない」（Server Actions、mywork#882）。
 *
 * Server Actions にしたのは、Next.js が Origin と Host の一致を確かめてくれるから。
 * 別のサイトのフォームから利用者のブラウザに「許可する」を押させる攻撃（同意の CSRF）を、
 * Cookie の SameSite=Lax と合わせて二重に防ぐ。
 * 許可・拒否の判定と記録は Supabase Auth が行い、ここは結果の URL（AI の戻り先）へ送るだけ。
 */

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAuthorizationId } from "./authorization-id";

async function decide(formData: FormData, decision: "approve" | "deny") {
  const id = formData.get("authorization_id");
  if (!isAuthorizationId(id)) redirect("/oauth/consent?error=invalid");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);

  const { data, error } =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) redirect("/oauth/consent?error=expired");
  // 戻り先は Supabase が「AI が登録した redirect_uri と完全一致」を確かめた URL
  redirect(data.redirect_url);
}

export async function approveAction(formData: FormData) {
  await decide(formData, "approve");
}

export async function denyAction(formData: FormData) {
  await decide(formData, "deny");
}
